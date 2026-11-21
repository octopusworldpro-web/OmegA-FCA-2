"use strict";

const { randomUUID, randomInt } = require("node:crypto");
const mqtt = require("./mqtt311Codec");
const { parseMessengerSyncPayload } = require("./facebookMqttEvents");
const { createMqttRequestTracker } = require("./mqttRequestTracker");
const { createMessengerSendMessageRequest } = require("./messengerActions");

const DEFAULT_MQTT_URL = "wss://edge-chat.facebook.com/chat";
const DEFAULT_MQTT_APP_ID = "219994525426954";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_MQTT_TOPICS = Object.freeze([
  "/ls_req", "/ls_resp", "/legacy_web", "/webrtc", "/rtc_multi", "/onevc",
  "/br_sr", "/sr_res", "/t_ms", "/thread_typing", "/orca_typing_notifications",
  "/notify_disconnect", "/orca_presence", "/inbox", "/mercury", "/messaging_events",
  "/orca_message_notifications", "/pp", "/webrtc_response", "/legacy_web_mtouch"
]);

function safeId(value, name) {
  const text = String(value ?? "");
  if (!/^\d{5,30}$/.test(text)) throw new TypeError(name + " must be a numeric Facebook ID");
  return text;
}

function parseJsonPayload(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Facebook Messenger MQTT 3.1 adapter based on public FCA wire observations.
 * It implements the observed broker CONNECT/SUBSCRIBE/queue bootstrap only.
 * Message delta semantics and FCA action payloads remain separate concerns.
 */
function createFacebookMqttProtocol(options = {}) {
  const userId = safeId(options.userId, "userId");
  const keepAliveSeconds = options.keepAlive ?? 10;
  if (!Number.isInteger(keepAliveSeconds) || keepAliveSeconds < 0 || keepAliveSeconds > 65535) {
    throw new TypeError("keepAlive must be an integer between 0 and 65535 seconds");
  }
  const clientId = options.clientId ?? "mqttwsclient";
  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) {
    throw new TypeError("clientId must be 8-128 safe characters");
  }
  const sessionId = options.sessionId ?? randomInt(1, 2 ** 48);
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new TypeError("sessionId must be a positive safe integer");
  const deviceId = options.deviceId ?? randomUUID();
  if (typeof deviceId !== "string" || deviceId.length > 128) throw new TypeError("deviceId is invalid");
  const appId = String(options.appId ?? DEFAULT_MQTT_APP_ID);
  if (!/^\d{5,30}$/.test(appId)) throw new TypeError("appId is invalid");
  const topics = options.topics ?? DEFAULT_MQTT_TOPICS;
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 64 ||
      topics.some(topic => typeof topic !== "string" || !topic.startsWith("/") || topic.length > 256)) {
    throw new TypeError("topics must be a list of safe MQTT topic filters");
  }
  const url = new URL(options.url ?? DEFAULT_MQTT_URL);
  if (url.protocol !== "wss:" || url.hostname !== "edge-chat.facebook.com" || url.pathname !== "/chat") {
    throw new TypeError("Facebook MQTT URL must use edge-chat.facebook.com/chat");
  }
  url.searchParams.set("sid", String(sessionId));
  if (options.region) {
    if (!/^[a-z]{2,8}$/i.test(options.region)) throw new TypeError("region is invalid");
    url.searchParams.set("region", options.region.toLowerCase());
  }
  const username = {
    u: userId, s: sessionId, chat_on: options.online !== false, fg: false, d: deviceId,
    ct: "websocket", aid: appId, aids: null, mqtt_sid: "", cp: 3, ecp: 10,
    st: [], pm: [], dc: "", no_auto_fg: true, gas: null, pack: [], p: null, php_override: "",
    a: String(options.userAgent || DEFAULT_USER_AGENT)
  };
  const headers = {
    Origin: "https://www.facebook.com",
    Referer: "https://www.facebook.com/",
    ...(options.userAgent ? { "User-Agent": String(options.userAgent) } : {}),
    ...(options.cookie ? { Cookie: String(options.cookie) } : {})
  };
  if (headers.Cookie && /[\r\n]/.test(headers.Cookie)) throw new TypeError("cookie header contains invalid characters");
  const cursorStore = options.syncCursorStore || null;
  let packetId = randomInt(1, 65536);
  const requestTracker = createMqttRequestTracker({ timeoutMs: options.requestTimeoutMs ?? 15000, maxPending: options.maxPendingRequests ?? 256 });
  let heartbeatState = null;

  function stopHeartbeat() {
    if (!heartbeatState) return;
    const current = heartbeatState;
    heartbeatState = null;
    clearInterval(current.timer);
    if (typeof current.socket.removeListener === "function") {
      current.socket.removeListener("close", current.onClose);
    } else if (typeof current.socket.removeEventListener === "function") {
      current.socket.removeEventListener("close", current.onClose);
    }
  }

  function startHeartbeat(socket) {
    stopHeartbeat();
    if (keepAliveSeconds === 0) return;
    const intervalMs = Math.max(1, Math.floor(keepAliveSeconds * 500));
    const current = { socket, awaitingPingResponse: false, timer: null, onClose: null };
    current.onClose = () => {
      if (heartbeatState === current) stopHeartbeat();
    };
    current.timer = setInterval(() => {
      if (heartbeatState !== current) return;
      if (socket.readyState !== undefined && socket.readyState !== 1) {
        stopHeartbeat();
        return;
      }
      if (current.awaitingPingResponse) {
        stopHeartbeat();
        try { socket.close?.(4000, "MQTT PINGRESP timeout"); } catch {}
        return;
      }
      current.awaitingPingResponse = true;
      try { socket.send(mqtt.encodePingReq()); }
      catch {
        stopHeartbeat();
        try { socket.close?.(); } catch {}
      }
    }, intervalMs);
    if (typeof current.timer.unref === "function") current.timer.unref();
    if (typeof socket.once === "function") socket.once("close", current.onClose);
    else if (typeof socket.addEventListener === "function") socket.addEventListener("close", current.onClose, { once: true });
    heartbeatState = current;
  }
  const nextPacketId = () => { packetId = packetId >= 65535 ? 1 : packetId + 1; return packetId; };

  function decodePacket(frame) {
    const bytes = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
    const packet = mqtt.decodePacket(bytes);
    if (!packet) throw new Error("Incomplete MQTT packet in WebSocket frame");
    return packet;
  }

  return Object.freeze({
    url: url.toString(),
    headers: Object.freeze(headers),
    session: Object.freeze({ userId, clientId, sessionId, deviceId, appId }),
    protocol: Object.freeze({
      async authenticate(socket, context) {
        socket.send(mqtt.encodeConnect({
          clientId, protocolId: "MQIsdp", protocolVersion: 3, keepAlive: keepAliveSeconds,
          cleanSession: true, username: JSON.stringify(username)
        }));
        const response = decodePacket(await context.waitForFrame());
        if (response.type !== "connack" || response.returnCode !== 0) {
          const error = new Error("Facebook MQTT broker rejected the connection");
          error.code = "FCA_MQTT_CONNACK_REJECTED";
          error.retryable = response.returnCode === 3;
          throw error;
        }
      },
      async subscribe(socket, context) {
        const currentCursor = cursorStore ? cursorStore.load() : null;
        const syncToken = options.syncToken ?? currentCursor?.syncToken ?? null;
        const lastSeqId = options.lastSeqId ?? currentCursor?.lastSeqId ?? null;
        const id = nextPacketId();
        socket.send(mqtt.encodeSubscribe(id, topics.map(topic => ({ topic, qos: 1 }))));
        const response = decodePacket(await context.waitForFrame());
        if (response.type !== "suback" || response.packetId !== id || response.grants.some(code => code === 0x80)) {
          const error = new Error("Facebook MQTT topic subscription was rejected");
          error.code = "FCA_MQTT_SUBSCRIBE_REJECTED";
          throw error;
        }
        const queue = {
          sync_api_version: 10, max_deltas_able_to_process: 1000, delta_batch_size: 500,
          encoding: "JSON", entity_fbid: userId,
          initial_titan_sequence_id: lastSeqId ?? null, device_params: null
        };
        const queueTopic = syncToken ? "/messenger_sync_get_diffs" : "/messenger_sync_create_queue";
        if (syncToken) {
          if (typeof syncToken !== "string" || syncToken.length > 4096) throw new TypeError("syncToken is invalid");
          queue.last_seq_id = lastSeqId;
          queue.sync_token = syncToken;
        }
        socket.send(mqtt.encodePublish({ topic: queueTopic, payload: JSON.stringify(queue), qos: 1, packetId: nextPacketId() }));
        // Match the established web FCA bootstrap: declare foreground/online
        // state and client availability immediately after queue initialization.
        socket.send(mqtt.encodePublish({ topic: "/foreground_state", payload: JSON.stringify({ foreground: options.online !== false }), qos: 1, packetId: nextPacketId() }));
        socket.send(mqtt.encodePublish({ topic: "/set_client_settings", payload: JSON.stringify({ make_user_available_when_in_foreground: true }), qos: 1, packetId: nextPacketId() }));
        // Send PINGREQ at half the negotiated interval. If the broker fails
        // to answer before the next interval, close the socket so the
        // supervisor can reconnect instead of leaving a dead session online.
        startHeartbeat(socket);
      },
      decodeFrame(frame, context = {}) {
        const packet = decodePacket(frame);
        if (packet.type === "pingresp" && heartbeatState) heartbeatState.awaitingPingResponse = false;
        if (packet.type === "publish") {
          if (packet.qos === 1 && context.socket) context.socket.send(mqtt.encodePacketId("puback", packet.packetId));
          const payload = parseJsonPayload(packet.payload);
          if (packet.topic === "/t_ms") {
            const parsed = parseMessengerSyncPayload(payload);
            const events = parsed.events.length ? parsed.events : [{
              type: "mqtt_publish", topic: packet.topic, qos: packet.qos, payload
            }];
            if (parsed.cursor) {
              if (cursorStore) { try { cursorStore.save(parsed.cursor); } catch { events.push({ type: "sync_cursor_persist_error" }); } }
              try { options.onSyncCursor?.(parsed.cursor); } catch {}
              events.push({ type: "sync_cursor", cursor: parsed.cursor });
            }
            return { events };
          }
          if (packet.topic === "/ls_resp") {
            const response = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
            const matched = response ? requestTracker.resolve(response) : false;
            return { events: [{ type: "mqtt_response", topic: packet.topic, qos: packet.qos, matched, payload }] };
          }
          return { events: [{ type: "mqtt_publish", topic: packet.topic, qos: packet.qos, payload }] };
        }
        return { events: [{ type: "mqtt_control", packet }] };
      },
      async encodeAction(action) {
        if (!action || typeof action !== "object" || typeof action.topic !== "string" ||
            !action.topic.startsWith("/") || action.topic.length > 256) {
          throw new TypeError("MQTT action requires a valid topic");
        }
        const payload = typeof action.payload === "string" || Buffer.isBuffer(action.payload) || action.payload instanceof Uint8Array
          ? action.payload : JSON.stringify(action.payload);
        return mqtt.encodePublish({
          topic: action.topic, payload, qos: action.qos ?? 1,
          packetId: (action.qos ?? 1) > 0 ? nextPacketId() : undefined
        });
      },
      async sendMessage(socket, input, requestOptions = {}) {
        const built = createMessengerSendMessageRequest(input);
        return this.request(socket, { app_id: built.app_id, payload: built.payload, type: built.type }, requestOptions);
      },
      async request(socket, payload, requestOptions = {}) {
        if (!socket || typeof socket.send !== "function") throw new TypeError("A connected MQTT socket is required");
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("MQTT request payload must be an object");
        const requestId = requestTracker.allocateId();
        const envelope = { ...payload, request_id: requestId };
        const responsePromise = requestTracker.track(requestId, requestOptions.timeoutMs ?? options.requestTimeoutMs ?? 15000);
        try {
          socket.send(mqtt.encodePublish({ topic: "/ls_req", payload: JSON.stringify(envelope), qos: 1, packetId: nextPacketId() }));
        } catch (error) {
          requestTracker.rejectAll(error);
          throw error;
        }
        return responsePromise;
      },
      closeRequests(reason) { stopHeartbeat(); requestTracker.rejectAll(reason); },
      getPendingRequestCount() { return requestTracker.pendingCount; }
    })
  });
}

module.exports = {
  DEFAULT_MQTT_URL,
  DEFAULT_MQTT_APP_ID,
  DEFAULT_MQTT_TOPICS,
  createFacebookMqttProtocol
};
