"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../src/api/client");

test("client accepts a valid AppState and exposes a narrow API facade", async () => {
  const client = createClient({
    authenticate: async ({ mode, credentials }) => {
      assert.equal(mode, "appstate");
      assert.equal(credentials[0].key, "c_user");
      return {
        getCurrentUserID: () => "123456",
        sendMessage: async () => ({ messageID: "m1" }),
        listen: () => () => {},
        disconnect: async () => {}
      };
    }
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(api.getCurrentUserID(), "123456");
  assert.equal(typeof api.sendMessage, "function");
  assert.equal(typeof api.listen, "function");
  await client.logout();
  assert.equal(client.getConnectionState().state, "idle");
});

test("client rejects a session without required auth cookies", async () => {
  const client = createClient({ requireLicense: false, authenticate: async () => ({}) });
  await assert.rejects(client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" }
  ] }), /c_user and xs/);
});

test("client rejects missing login mode", async () => {
  const client = createClient({ requireLicense: false, authenticate: async () => ({}) });
  await assert.rejects(client.login({}), /Login mode/);
});

test("client enforces owner-signed licensing when explicitly enabled", async () => {
  const client = createClient({ requireLicense: true, authenticate: async () => ({}) });
  await assert.rejects(client.login({ mode: "credentials", email: "demo@example.com", password: "not-a-real-password" }), /License token is missing/);
});


test("GoatBot MQTT callback receives (error, event) and can stop listening", async () => {
  let transportCallback;
  let detached = 0;
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      listen(callback) {
        transportCallback = callback;
        return () => { detached++; };
      },
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  const received = [];
  api.listenMqtt((error, event) => received.push({ error, event }));
  transportCallback(null, { type: "message", messageID: "m1" });
  assert.equal(received[0].error, null);
  assert.equal(received[0].event.messageID, "m1");
  api.stopListening();
  assert.equal(detached, 1);
  await client.logout();
});


test("client refreshes and verifies an owner license before transport authentication", async () => {
  const crypto = require("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "OmegA-License-Service",
    aud: "OmegA-FCA",
    licenseId: "lic_0123456789abcdef0123456789abcdef",
    ownerId: "owner-test",
    installationId: "install-test",
    iat: now,
    exp: now + 900,
    features: ["messaging"]
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const token = bytes.toString("base64url") + "." + crypto.sign(null, bytes, privateKey).toString("base64url");
  let refreshCount = 0;
  let authenticated = false;
  const client = createClient({
    requireLicense: true,
    license: {
      refresh: async () => { refreshCount++; return token; },
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      installationId: "install-test",
      ownerId: "owner-test",
      checkIntervalMs: 30_000
    },
    authenticate: async ({ license }) => {
      authenticated = true;
      assert.equal(license.licenseId, payload.licenseId);
      return { getCurrentUserID: () => "123456", listen: () => () => {}, disconnect: async () => {} };
    }
  });
  await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(refreshCount, 1);
  assert.equal(authenticated, true);
  await client.logout();
});


test("client enforces feature entitlements for methods and event listeners", async () => {
  const crypto = require("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "OmegA-License-Service", aud: "OmegA-FCA",
    licenseId: "lic_0123456789abcdef0123456789abcdef",
    ownerId: "owner-test", installationId: "install-test",
    iat: now, exp: now + 900, features: ["messaging"]
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const token = bytes.toString("base64url") + "." + crypto.sign(null, bytes, privateKey).toString("base64url");
  const client = createClient({
    requireLicense: true,
    license: {
      token,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      installationId: "install-test", ownerId: "owner-test"
    },
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      sendMessage: async () => "sent",
      getThreadInfo: async () => ({}),
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(await api.sendMessage("hello"), "sent");
  await assert.rejects(api.getThreadInfo("thread-1"), { code: "FCA_LICENSE_FEATURE_DENIED" });
  assert.throws(() => api.listenMqtt(() => {}), /events feature/);
  await client.logout();
});


test("client rejects overlapping login attempts", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createClient({
    requireLicense: false,
    reconnect: { maxAttempts: 1 },
    authenticate: async () => {
      await gate;
      return { listen: () => () => {}, disconnect: async () => {} };
    }
  });
  const credentials = { mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] };
  const first = client.login(credentials);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.login(credentials), /already in progress/);
  release();
  await first;
  await client.logout();
});

test("client preserves safe realtime transport failure codes after AppState validation", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => {
      const error = new Error("provider detail must not be exposed");
      error.code = "FCA_MQTT_CONNACK_REJECTED";
      error.retryable = false;
      throw error;
    }
  });
  await assert.rejects(
    client.login({ mode: "appstate", appState: [
      { key: "c_user", value: "123456", domain: "facebook.com" },
      { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
    ] }),
    error => {
      assert.equal(error.code, "FCA_MQTT_CONNACK_REJECTED");
      assert.match(error.message, /session was accepted, but Messenger realtime setup failed/);
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes("provider detail"), false);
      return true;
    }
  );
});

test("client does not expose arbitrary provider error codes or messages", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => {
      const error = new Error("private cookie value");
      error.code = "PRIVATE_PROVIDER_SECRET";
      throw error;
    }
  });
  await assert.rejects(
    client.login({ mode: "appstate", appState: [
      { key: "c_user", value: "123456", domain: "facebook.com" },
      { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
    ] }),
    error => {
      assert.equal(error.code, "FCA_AUTHENTICATION_FAILED");
      assert.equal(error.message, "Authentication failed; inspect provider diagnostics securely");
      assert.equal(error.message.includes("private cookie value"), false);
      return true;
    }
  );
});
