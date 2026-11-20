"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createFacebookMqttClient } = require("../src/compat/facebookMqttClient");
const mqtt = require("../src/transport/mqtt311Codec");

const appState = [
  { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { key: "xs", value: "synthetic-session", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
];

function response() {
  const html = '<html><script>{"USER_ID":"123456789012345"}</script></html>';
  return {
    status: 200, ok: true,
    headers: {
      get: name => name.toLowerCase() === "content-length" ? String(Buffer.byteLength(html)) :
        name.toLowerCase() === "content-type" ? "text/html" : null,
      getSetCookie: () => []
    },
    text: async () => html
  };
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    setImmediate(() => { this.readyState = 1; this.emit("open"); });
  }
  send(frame) {
    const bytes = Buffer.from(frame);
    const type = bytes[0] >> 4;
    if (type === 1) setImmediate(() => this.emit("message", Buffer.from([0x20, 0x02, 0, 0])));
    if (type === 8) {
      const remaining = mqtt.decodeRemainingLength(bytes);
      const id = bytes.readUInt16BE(remaining.offset);
      setImmediate(() => this.emit("message", Buffer.from([0x90, 0x03, id >> 8, id & 255, 1])));
    }
  }
  close() {
    this.readyState = 3;
    setImmediate(() => this.emit("close", 1000));
  }
}

test("first-party client logs in with AppState and exposes callback-compatible MQTT lifecycle", async () => {
  const client = createFacebookMqttClient({
    socketFactory: () => new FakeSocket(),
    fetchImpl: async () => response(),
    mqtt: { keepAlive: 0 }
  });
  const api = await client.login({ mode: "appstate", appState });
  assert.equal(api.getCurrentUserID(), "123456789012345");
  assert.equal(typeof api.listenMqtt, "function");
  assert.equal(typeof api.sendMessage, "function");
  assert.equal(typeof api.getThreadList, "function");
  assert.equal(typeof api.getThreadInfo, "function");
  assert.equal(typeof api.getThreadHistory, "function");
  assert.equal(typeof api.getUserInfo, "function");
  assert.equal(typeof api.addUserToGroup, "function");
  assert.equal(typeof api.removeUserFromGroup, "function");
  assert.equal(typeof api.changeNickname, "function");
  assert.equal(typeof api.setMessageReaction, "function");
  assert.equal(typeof api.markAsRead, "function");
  let readyEvent = null;
  const stop = api.listenMqtt((error, event) => {
    if (!error && event?.type === "ready") readyEvent = event;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readyEvent?.source, "omega-fca");
  assert.equal(readyEvent?.connectionState?.connected, true);
  stop();
  await client.logout();
});

test("first-party client supplies its package-managed WebSocket implementation by default", () => {
  assert.doesNotThrow(() => createFacebookMqttClient());
});


test("first-party client exposes configured automatic SessionGuard lifecycle", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-client-guard-"));
  const filePath = path.join(directory, "account.enc");
  const client = createFacebookMqttClient({
    socketFactory: () => new FakeSocket(),
    fetchImpl: async () => response(),
    mqtt: { keepAlive: 0 },
    sessionGuard: { filePath, key: "b".repeat(64), intervalMs: 60_000 }
  });
  try {
    const api = await client.login({ mode: "appstate", appState });
    assert.equal(typeof api.sessionGuard, "function");
    assert.equal(api.sessionGuard().filePath, filePath);
    assert.equal(typeof api.stopSessionGuard, "function");
    assert.equal(await api.stopSessionGuard(), true);
    await client.logout();
  } finally {
    await client.logout();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
