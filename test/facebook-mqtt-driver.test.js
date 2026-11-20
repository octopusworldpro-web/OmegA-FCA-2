"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFacebookMqttDriver } = require("../src/transport/facebookMqttDriver");
const { createFacebookMqttClient } = require("../src/compat/facebookMqttClient");
const mqtt = require("../src/transport/mqtt311Codec");

const appState = [
  { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { key: "xs", value: "session-token", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
];

function htmlResponse() {
  const html = '<html><script>{"USER_ID":"123456789012345"}</script></html>';
  return {
    status: 200, ok: true,
    headers: { get: name => name.toLowerCase() === "content-length" ? String(Buffer.byteLength(html)) : name.toLowerCase() === "content-type" ? "text/html" : null, getSetCookie: () => [] },
    text: async () => html
  };
}

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    setImmediate(() => { this.readyState = 1; this.emit("open"); });
  }
  send(frame) {
    const bytes = Buffer.from(frame);
    const type = bytes[0] >> 4;
    if (type === 1) setImmediate(() => this.emit("message", Buffer.from([0x20, 0x02, 0x00, 0x00])));
    if (type === 8) {
      const remaining = mqtt.decodeRemainingLength(bytes);
      const packetId = bytes.readUInt16BE(remaining.offset);
      setImmediate(() => this.emit("message", Buffer.from([0x90, 0x03, packetId >> 8, packetId & 0xff, 0x01])));
    }
  }
  close() {
    this.readyState = 3;
    setImmediate(() => this.emit("close", 1000));
  }
}

test("integrated driver validates AppState, authenticates MQTT and exposes an FCA driver", async () => {
  const driver = await createFacebookMqttDriver({
    appState,
    fetchImpl: async () => htmlResponse(),
    socketFactory: () => new FakeWebSocket(),
    mqtt: { keepAlive: 0 }
  });
  assert.equal(driver.getCurrentUserID(), "123456789012345");
  assert.equal(driver.getSessionState(), "active");
  assert.equal(typeof driver.listen, "function");
  assert.equal(typeof driver.sendMessage, "function");
  await driver.disconnect();
});

test("integrated driver requires an injected WebSocket implementation", async () => {
  await assert.rejects(createFacebookMqttDriver({ appState }), /socketFactory is required/);
});


test("native driver automatically snapshots AppState when SessionGuard is configured", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-guard-"));
  const filePath = path.join(directory, "session.enc");
  const key = "a".repeat(64);
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState,
      fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(),
      mqtt: { keepAlive: 0 },
      sessionGuard: { filePath, key, intervalMs: 60_000 }
    });
    const paths = driver.sessionGuard();
    assert.equal(paths.filePath, filePath);
    assert.equal(fs.existsSync(filePath), true);
    const saved = require("../src/security/sessionStore").loadSession(filePath, key);
    assert.equal(saved.userId, "123456789012345");
    assert.deepEqual(saved.appState.map(({ key, value }) => ({ key, value })), appState.map(({ key, value }) => ({ key, value })));
    assert.equal(typeof driver.stopSessionGuard, "function");
    assert.equal(await driver.stopSessionGuard(), true);
    assert.throws(() => driver.sessionGuard(), /SessionGuard is not configured/);
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy GoatBot account.txt SessionGuard call activates only the separate encrypted file", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-legacy-guard-"));
  const accountPath = path.join(directory, "account.txt");
  const encryptedPath = path.join(directory, "private", "facebook-session.enc");
  const originalAccount = JSON.stringify(appState);
  fs.writeFileSync(accountPath, originalAccount, "utf8");
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState,
      fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(),
      mqtt: { keepAlive: 0 },
      sessionGuard: { filePath: encryptedPath, key: "b".repeat(64), intervalMs: 60_000 }
    });
    const configured = driver.sessionGuard(accountPath, { interval: 180_000, debounce: 30_000 });
    assert.equal(configured.filePath, encryptedPath);
    assert.equal(fs.readFileSync(accountPath, "utf8"), originalAccount);
    assert.equal(fs.existsSync(encryptedPath), true);
    assert.notEqual(fs.readFileSync(encryptedPath, "utf8"), originalAccount);
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("GoatBot legacy SessionGuard alias uses optional FCA deployment environment settings", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-env-guard-"));
  const accountPath = path.join(directory, "account.txt");
  const encryptedPath = path.join(directory, "private", "session.enc");
  const originalAccount = JSON.stringify(appState);
  fs.writeFileSync(accountPath, originalAccount, "utf8");
  const previous = {
    file: process.env.FCA_SESSION_FILE,
    key: process.env.FCA_SESSION_KEY,
    interval: process.env.FCA_SESSION_INTERVAL_MS
  };
  let client;
  try {
    process.env.FCA_SESSION_FILE = encryptedPath;
    process.env.FCA_SESSION_KEY = "c".repeat(64);
    process.env.FCA_SESSION_INTERVAL_MS = "180000";
    client = createFacebookMqttClient({
      socketFactory: () => new FakeWebSocket(),
      fetchImpl: async () => htmlResponse(),
      mqtt: { keepAlive: 0 }
    });
    const api = await client.login({ mode: "appstate", appState });
    const configured = api.sessionGuard(accountPath, { interval: 180_000, debounce: 30_000 });
    assert.equal(configured.filePath, encryptedPath);
    assert.equal(fs.existsSync(encryptedPath), true);
    assert.equal(fs.readFileSync(accountPath, "utf8"), originalAccount);
    await client.logout();
  } finally {
    if (client) await client.logout().catch(() => {});
    if (previous.file === undefined) delete process.env.FCA_SESSION_FILE; else process.env.FCA_SESSION_FILE = previous.file;
    if (previous.key === undefined) delete process.env.FCA_SESSION_KEY; else process.env.FCA_SESSION_KEY = previous.key;
    if (previous.interval === undefined) delete process.env.FCA_SESSION_INTERVAL_MS; else process.env.FCA_SESSION_INTERVAL_MS = previous.interval;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native driver rejects SessionGuard without an explicit encryption key", async () => {
  await assert.rejects(createFacebookMqttDriver({
    appState,
    fetchImpl: async () => htmlResponse(),
    socketFactory: () => new FakeWebSocket(),
    mqtt: { keepAlive: 0 },
    sessionGuard: { filePath: "/tmp/omega-session.enc" }
  }), /explicit 32-byte\/64-hex encryption key/);
});


test("native driver rejects an encrypted snapshot restored for a different Facebook account", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-identity-"));
  const filePath = path.join(directory, "session.enc");
  const key = "9".repeat(64);
  require("../src/security/sessionStore").saveSession(filePath, {
    version: 1,
    userId: "999999999999999",
    appState,
    savedAt: Date.now()
  }, key);
  try {
    await assert.rejects(createFacebookMqttDriver({
      fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(),
      mqtt: { keepAlive: 0 },
      sessionGuard: { filePath, key }
    }), error => error.code === "FCA_SESSION_IDENTITY_MISMATCH");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
