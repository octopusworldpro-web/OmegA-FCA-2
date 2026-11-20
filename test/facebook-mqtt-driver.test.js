"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFacebookMqttDriver } = require("../src/transport/facebookMqttDriver");
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
    assert.deepEqual(saved.appState, appState);
    assert.equal(typeof driver.stopSessionGuard, "function");
    assert.equal(await driver.stopSessionGuard(), true);
    assert.equal(driver.sessionGuard(), null);
  } finally {
    if (driver) await driver.disconnect();
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
