"use strict";

const path = require("node:path");
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
  let session = null;
  let closed = false;
  let transport;
  let guard = null;
  try {
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
        getSession: () => {
          if (!session) throw new Error("Facebook session is not initialized");
          return {
            version: 1,
            userId: session.userId,
            appState: session.getAppState(),
            savedAt: Date.now()
          };
        }
      });
    }
    let activeAppState = appState;
    let restoredSnapshot = null;
    if (!Array.isArray(activeAppState) || activeAppState.length === 0) {
      if (!guard) {
        const error = new Error("No encrypted saved session is configured; supply AppState or configure SessionGuard");
        error.code = "FCA_SESSION_GUARD_MISSING";
        error.retryable = false;
        throw error;
      }
      try {
        restoredSnapshot = guard.load();
      } catch (cause) {
        const error = new Error("No usable encrypted saved session was found; supply a fresh AppState or repair the SessionGuard snapshot");
        error.code = cause?.code === "ENOENT" ? "FCA_SESSION_SNAPSHOT_MISSING" : "FCA_SESSION_RESTORE_FAILED";
        error.retryable = false;
        throw error;
      }
      if (!Array.isArray(restoredSnapshot.appState) || restoredSnapshot.appState.length === 0) {
        const error = new Error("Encrypted SessionGuard snapshot does not contain an AppState cookie array");
        error.code = "FCA_SESSION_RESTORE_FAILED";
        error.retryable = false;
        throw error;
      }
      activeAppState = restoredSnapshot.appState;
    }
    session = await createPersonalSession({ appState: activeAppState, fetchImpl, userAgent, timeoutMs, onDiagnostic });
    if (restoredSnapshot?.userId != null && String(restoredSnapshot.userId) !== session.userId) {
      const error = new Error("Restored Facebook session identity does not match the encrypted snapshot");
      error.code = "FCA_SESSION_IDENTITY_MISMATCH";
      error.retryable = false;
      throw error;
    }
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
    if (guard) {
      await guard.saveNow();
      guard.start(sessionGuardOptions.intervalMs === undefined ? 60_000 : sessionGuardOptions.intervalMs);
    }

    const threadApi = createFacebookThreadApi({ session });
    const stopSessionGuard = async () => {
      if (!guard) return false;
      const active = guard;
      guard = null;
      active.stop();
      try {
        await active.saveNow();
        return true;
      } catch (error) {
        // GoatBot's historical caller does not await this method in every
        // shutdown/recovery path. Resolve safely rather than leaking an
        // unhandled rejection while still closing the guard deterministically.
        try {
          if (typeof sessionGuardOptions.onRecovery === "function") {
            sessionGuardOptions.onRecovery(Object.freeze({
              source: "save", restored: false,
              errorCode: error.code || "FCA_SESSION_GUARD_SAVE_FAILED"
            }));
          }
        } catch {}
        return false;
      } finally {
        active.close();
      }
    };
    return Object.freeze({
      ...driver,
      ...threadApi,
      getCurrentUserID: () => session.userId,
      getSessionState: () => session.state,
      sessionGuard: (requestedPath, legacyOptions = {}) => {
        if (!guard) throw new Error("Encrypted SessionGuard is not configured; set FCA_SESSION_FILE and FCA_SESSION_KEY or pass sessionGuard.filePath/key");
        const paths = guard.getPaths();
        if (requestedPath && path.resolve(requestedPath) !== paths.filePath) {
          if (path.basename(path.resolve(requestedPath)).toLowerCase() !== "account.txt") {
            throw new Error("SessionGuard uses its separately configured encrypted snapshot path");
          }
        }
        if (legacyOptions && legacyOptions.interval !== undefined) {
          guard.stop();
          guard.start(legacyOptions.interval);
        }
        return Object.freeze({ ...paths, saveNow: guard.saveNow });
      },
      stopSessionGuard,
      disconnect: async () => {
        if (closed) return;
        closed = true;
        try {
          try { await stopSessionGuard(); }
          finally { await transport.disconnect(); }
        } finally { session.close(); }
      }
    });
  } catch (error) {
    if (guard) { try { guard.close(); } catch {} }
    try { if (transport) await transport.disconnect(); } catch {}
    if (session) session.close();
    throw error;
  }
}

module.exports = { createFacebookMqttDriver };
