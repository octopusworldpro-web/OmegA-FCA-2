"use strict";

const { createPersonalSession } = require("../auth/personalSession");
const { createSessionGuard } = require("../security/sessionGuard");
const { createFacebookMqttProtocol } = require("./facebookMqttProtocol");
const { createNativeRealtimeTransport } = require("./nativeRealtimeTransport");
const { createFacebookThreadApi } = require("./facebookThreadApi");

/**
 * Builds an owner-authorized personal Messenger MQTT driver.
 * Thread and group methods use the same authenticated Facebook web session
 * and public FCA request conventions; their private endpoints can change.
 */
async function createFacebookMqttDriver({
  appState, socketFactory, fetchImpl, userAgent, timeoutMs = 20000,
  connectTimeoutMs = 15000, closeTimeoutMs = 3000, protocolSetupTimeoutMs = 15000,
  maxFrameBytes, syncCursorStore, onSyncCursor, requestTimeoutMs, maxPendingRequests,
  mqtt = {}, onDiagnostic, sessionGuard: sessionGuardOptions
} = {}) {
  if (typeof socketFactory !== "function") throw new TypeError("socketFactory is required");
  const session = await createPersonalSession({ appState, fetchImpl, userAgent, timeoutMs, onDiagnostic });
  let closed = false;
  let transport;
  let guard = null;
  try {
    const protocolConfig = createFacebookMqttProtocol({
      ...mqtt, userId: session.userId,
      url: mqtt.url || session.realtime.endpoint || undefined,
      region: mqtt.region || session.realtime.region || undefined,
      lastSeqId: mqtt.lastSeqId || session.realtime.lastSeqId || undefined,
      cookie: session.getCookieHeader("https://edge-chat.facebook.com/chat"),
      userAgent, syncCursorStore, onSyncCursor, requestTimeoutMs, maxPendingRequests
    });
    transport = createNativeRealtimeTransport({
      url: protocolConfig.url, headers: protocolConfig.headers, socketFactory,
      protocol: protocolConfig.protocol, connectTimeoutMs, closeTimeoutMs,
      protocolSetupTimeoutMs,
      ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }), onDiagnostic
    });
    await transport.connect();
    const driver = transport.getDriver();

    // Session persistence is opt-in and requires an explicit owner-managed key.
    // Never generate a key here: deployments must store it outside source control.
    if (sessionGuardOptions != null) {
      if (!sessionGuardOptions || typeof sessionGuardOptions !== "object" ||
          typeof sessionGuardOptions.filePath !== "string" ||
          !(typeof sessionGuardOptions.key === "string" || Buffer.isBuffer(sessionGuardOptions.key) || sessionGuardOptions.key instanceof Uint8Array)) {
        throw new TypeError("sessionGuard requires filePath and an explicit 32-byte/64-hex encryption key");
      }
      guard = createSessionGuard({
        filePath: sessionGuardOptions.filePath,
        backupPath: sessionGuardOptions.backupPath,
        key: sessionGuardOptions.key,
        onRecovery: sessionGuardOptions.onRecovery,
        getSession: () => ({
          version: 1,
          userId: session.userId,
          appState: session.getAppState(),
          savedAt: Date.now()
        })
      });
      await guard.saveNow();
      guard.start(sessionGuardOptions.intervalMs === undefined ? 60_000 : sessionGuardOptions.intervalMs);
    }

    const threadApi = createFacebookThreadApi({ session });
    const stopSessionGuard = async () => {
      if (!guard) return false;
      const active = guard;
      guard = null;
      active.stop();
      try { await active.saveNow(); }
      finally { active.close(); }
      return true;
    };
    return Object.freeze({
      ...driver,
      ...threadApi,
      getCurrentUserID: () => session.userId,
      getSessionState: () => session.state,
      sessionGuard: () => guard ? Object.freeze({ ...guard.getPaths(), saveNow: guard.saveNow }) : null,
      stopSessionGuard,
      disconnect: async () => {
        if (closed) return;
        closed = true;
        try {
          await stopSessionGuard();
          await transport.disconnect();
        } finally { session.close(); }
      }
    });
  } catch (error) {
    if (guard) { try { guard.close(); } catch {} }
    try { if (transport) await transport.disconnect(); } catch {}
    session.close();
    throw error;
  }
}

module.exports = { createFacebookMqttDriver };
