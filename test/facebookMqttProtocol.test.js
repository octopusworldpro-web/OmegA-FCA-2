"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mqtt = require("../src/transport/mqtt311Codec");
const {
  DEFAULT_MQTT_URL, DEFAULT_MQTT_TOPICS, createFacebookMqttProtocol
} = require("../src/transport/facebookMqttProtocol");

test("builds the observed Messenger MQTT broker URL and browser headers", () => {
  const config = createFacebookMqttProtocol({
    userId: "123456789", region: "FRA", cookie: "c_user=123456789; xs=private", userAgent: "OmegA-Test-UA"
  });
  const url = new URL(config.url);
  assert.equal(url.origin + url.pathname, DEFAULT_MQTT_URL);
  assert.equal(url.searchParams.get("region"), "fra");
  assert.equal(url.searchParams.get("sid"), String(config.session.sessionId));
  assert.equal(url.searchParams.has("cid"), false);
  assert.equal(config.session.clientId, "mqttwsclient");
  assert.equal(config.headers.Origin, "https://www.facebook.com");
  assert.equal(config.headers.Cookie, "c_user=123456789; xs=private");
  assert.equal(DEFAULT_MQTT_TOPICS.includes("/t_ms"), true);
  assert.equal(DEFAULT_MQTT_TOPICS.includes("/legacy_web_mtouch"), true);
});

test("performs MQTT 3.1 CONNECT and validates broker CONNACK", async () => {
  const config = createFacebookMqttProtocol({ userId: "123456789" });
  const sent = [];
  const socket = { send: frame => sent.push(Buffer.from(frame)) };
  await config.protocol.authenticate(socket, {
    waitForFrame: async () => Buffer.from([0x20, 0x02, 0x00, 0x00])
  });
  const connect = mqtt.decodeRemainingLength(sent[0]);
  assert.equal(sent[0][0], 0x10);
  assert.equal(sent[0].toString("ascii", connect.offset + 2, connect.offset + 8), "MQIsdp");
  assert.equal(sent[0].toString("utf8").includes('"a":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"'), true);
  await assert.rejects(config.protocol.authenticate(socket, {
    waitForFrame: async () => Buffer.from([0x20, 0x02, 0x00, 0x05])
  }), error => error.code === "FCA_MQTT_CONNACK_REJECTED");
});

test("subscribes to observed topics and initializes the Messenger sync queue", async () => {
  const config = createFacebookMqttProtocol({ userId: "123456789", lastSeqId: "77" });
  const sent = [];
  const socket = { send: frame => sent.push(Buffer.from(frame)) };
  await config.protocol.subscribe(socket, {
    waitForFrame: async () => {
      const subscribe = sent[sent.length - 1];
      const remaining = mqtt.decodeRemainingLength(subscribe);
      const id = subscribe.readUInt16BE(remaining.offset);
      return Buffer.from([0x90, 0x03, id >> 8, id & 0xff, 0x01]);
    }
  });
  assert.equal(sent[0][0], 0x82);
  const queue = mqtt.decodePacket(sent[1]);
  assert.equal(queue.type, "publish");
  assert.equal(queue.topic, "/messenger_sync_create_queue");
  const queuePayload = JSON.parse(queue.payload.toString());
  assert.equal(queuePayload.entity_fbid, "123456789");
  assert.equal(queuePayload.sync_api_version, 10);
  assert.equal(queuePayload.max_deltas_able_to_process, 1000);
  assert.equal(queuePayload.delta_batch_size, 500);
  assert.equal(mqtt.decodePacket(sent[2]).topic, "/foreground_state");
  assert.deepEqual(JSON.parse(mqtt.decodePacket(sent[2]).payload.toString()), { foreground: true });
  assert.equal(mqtt.decodePacket(sent[3]).topic, "/set_client_settings");
  assert.deepEqual(JSON.parse(mqtt.decodePacket(sent[3]).payload.toString()), { make_user_available_when_in_foreground: true });
});

test("decodes MQTT publish frames and encodes bounded topic actions", async () => {
  const config = createFacebookMqttProtocol({ userId: "123456789" });
  const socketFrames = [];
  const decoded = config.protocol.decodeFrame(
    mqtt.encodePublish({ topic: "/t_ms", payload: JSON.stringify({ seq: 4 }), qos: 1, packetId: 9 }),
    { socket: { send: frame => socketFrames.push(Buffer.from(frame)) } }
  );
  assert.equal(decoded.events[0].topic, "/t_ms");
  assert.deepEqual(decoded.events[0].payload, { seq: 4 });
  assert.deepEqual(mqtt.decodePacket(socketFrames[0]), { type: "puback", packetId: 9 });
  const action = await config.protocol.encodeAction({ topic: "/ls_req", payload: { request_id: 1 } });
  assert.equal(mqtt.decodePacket(action).topic, "/ls_req");
});

test("rejects invalid IDs, endpoints, topic lists and cookie injection", () => {
  assert.throws(() => createFacebookMqttProtocol({ userId: "abc" }), /numeric Facebook ID/);
  assert.throws(() => createFacebookMqttProtocol({ userId: "123456789", url: "wss://evil.example/chat" }), /edge-chat.facebook.com/);
  assert.throws(() => createFacebookMqttProtocol({ userId: "123456789", cookie: "a=b\r\nInjected: yes" }), /invalid characters/);
  assert.throws(() => createFacebookMqttProtocol({ userId: "123456789", topics: ["bad"] }), /topic filters/);
});
