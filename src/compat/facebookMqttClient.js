"use strict";

const { createClient } = require("../api/client");
const { createFacebookMqttDriver } = require("../transport/facebookMqttDriver");

function defaultSocketFactory({ url, protocols, headers } = {}) {
  // Keep the WebSocket implementation inside the package so applications do
  // not need to provide an adapter or install a separate transport dependency.
  const WebSocket = require("ws");
  return new WebSocket(url, protocols, { headers });
}

/**
 * Creates the first-party AppState and encrypted-SessionGuard personal Messenger client.
 * The package owns its WebSocket implementation; tests and advanced users
 * may still inject a compatible socketFactory.
 */
function createFacebookMqttClient(options = {}) {
  const {
    socketFactory = defaultSocketFactory,
    fetchImpl,
    userAgent,
    timeoutMs,
    connectTimeoutMs,
    closeTimeoutMs,
    protocolSetupTimeoutMs,
    maxFrameBytes,
    syncCursorStore,
    onSyncCursor,
    requestTimeoutMs,
    maxPendingRequests,
    mqtt,
    onDiagnostic,
    sessionGuard,
    reconnect,
    license,
    requireLicense,
    onLicenseError
  } = options;

  // Optional deployment-only encrypted persistence. This lets the existing
  // GoatBot adapter keep its account.txt call site while FCA stores snapshots
  // in a separate encrypted file. Never derive the key from Bot config.
  const envSessionFile = process.env.FCA_SESSION_FILE;
  const envSessionKey = process.env.FCA_SESSION_KEY;
  const envInterval = Number(process.env.FCA_SESSION_INTERVAL_MS);
  const configuredSessionGuard = sessionGuard || (
    typeof envSessionFile === "string" && envSessionFile.trim() &&
    typeof envSessionKey === "string" && envSessionKey.trim()
      ? {
          filePath: envSessionFile,
          key: envSessionKey,
          ...(Number.isInteger(envInterval) && envInterval >= 1000 ? { intervalMs: envInterval } : {})
        }
      : undefined
  );

  if (typeof socketFactory !== "function") {
    throw new TypeError("socketFactory must be a function");
  }

  return createClient({
    reconnect,
    license,
    requireLicense,
    onLicenseError,
    authenticate: ({ mode, credentials }) => {
      if (mode !== "appstate" && mode !== "session") {
        throw new TypeError("Native Messenger client supports AppState or encrypted SessionGuard login");
      }
      return createFacebookMqttDriver({
        appState: mode === "appstate" ? credentials : undefined,
        socketFactory,
        fetchImpl,
        userAgent,
        timeoutMs,
        connectTimeoutMs,
        closeTimeoutMs,
        protocolSetupTimeoutMs,
        maxFrameBytes,
        syncCursorStore,
        onSyncCursor,
        requestTimeoutMs,
        maxPendingRequests,
        mqtt,
        onDiagnostic,
        sessionGuard: configuredSessionGuard
      });
    }
  });
}

module.exports = { createFacebookMqttClient };
