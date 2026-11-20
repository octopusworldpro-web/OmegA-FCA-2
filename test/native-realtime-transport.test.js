"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createNativeRealtimeTransport } = require("../src/transport/nativeRealtimeTransport");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    setImmediate(() => { this.readyState = 1; this.emit("open"); });
  }
  send(frame, callback) { this.sent.push(frame); callback?.(); }
  close() { this.readyState = 3; this.emit("close", 1000); }
}

function makeProtocol() {
  return {
    async authenticate(socket) { socket.authenticated = true; },
    async subscribe(socket) { socket.subscribed = true; },
    decodeFrame(frame) { return { events: [{ name: "fixture", args: frame.toString() }] }; },
    encodeAction(action) { return Buffer.from(JSON.stringify(action)); }
  };
}

test("connects, authenticates, subscribes, receives events and sends encoded actions", async () => {
  const socket = new FakeSocket();
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: async () => socket,
    protocol: makeProtocol()
  });

  const driver = await transport.connect({ attempt: 0 });
  assert.equal(transport.snapshot().state, "connected");
  assert.equal(socket.authenticated, true);
  assert.equal(socket.subscribed, true);

  let received;
  driver.listen((error, event) => { assert.equal(error, null); received = event; });
  socket.emit("message", Buffer.from("fixture-frame"), true);
  assert.deepEqual(received, { name: "fixture", args: "fixture-frame" });

  await driver.sendAction({ type: "fixture_action" });
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(JSON.parse(socket.sent[0].toString()), { type: "fixture_action" });

  await transport.disconnect();
  assert.equal(transport.snapshot().state, "closed");
});

test("rejects unverified endpoints and incomplete protocol adapters", () => {
  assert.throws(() => createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: () => new FakeSocket(),
    protocol: {}
  }), /protocol must implement/);
  assert.throws(() => createNativeRealtimeTransport({
    url: "https://fixture.invalid/realtime",
    socketFactory: () => new FakeSocket(),
    protocol: makeProtocol()
  }), /verified wss/);
});

test("reports unexpected socket closure through the driver listener", async () => {
  const socket = new FakeSocket();
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: async () => socket,
    protocol: makeProtocol()
  });
  const driver = await transport.connect();
  let failure;
  driver.listen(error => { failure = error; });
  socket.emit("close", 1006);
  assert.equal(failure.code, "FCA_WS_UNEXPECTED_CLOSE");
  assert.equal(transport.snapshot().state, "disconnected");
  await transport.disconnect();
});

test("enforces frame byte limits for text WebSocket frames in both directions", async () => {
  const socket = new FakeSocket();
  const protocol = {
    async authenticate() {},
    async subscribe() {},
    decodeFrame() { return { events: [] }; },
    encodeAction() { return "12345"; }
  };
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: async () => socket,
    protocol,
    maxFrameBytes: 4
  });
  const driver = await transport.connect();
  await assert.rejects(driver.sendAction({ type: "oversized" }), {
    code: "FCA_WS_FRAME_TOO_LARGE"
  });
  let failure;
  driver.listen(error => { failure = error; });
  socket.emit("message", "12345", false);
  assert.equal(failure.code, "FCA_WS_FRAME_TOO_LARGE");
  await transport.disconnect();
});

test("bounds a pending socket factory and closes a socket that arrives late", async () => {
  let resolveFactory;
  const socket = new EventEmitter();
  socket.readyState = 0;
  socket.send = () => {};
  let closeCount = 0;
  socket.close = () => { closeCount += 1; socket.readyState = 3; };
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: () => new Promise(resolve => { resolveFactory = resolve; }),
    protocol: makeProtocol(),
    connectTimeoutMs: 10
  });

  await assert.rejects(transport.connect(), { code: "FCA_WS_CREATE_TIMEOUT" });
  resolveFactory(socket);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closeCount, 1);
  assert.equal(transport.snapshot().state, "disconnected");
});

test("aborts a pending socket factory without waiting for its promise", async () => {
  const controller = new AbortController();
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: () => new Promise(() => {}),
    protocol: makeProtocol(),
    connectTimeoutMs: 1000
  });
  const pending = transport.connect({ signal: controller.signal });
  controller.abort(Object.assign(new Error("cancelled"), { code: "FCA_WS_ABORTED" }));
  await assert.rejects(pending, { code: "FCA_WS_ABORTED" });
});


test("ignores stale message handlers from a superseded socket generation", async () => {
  const sockets = [];
  const transport = createNativeRealtimeTransport({
    url: "wss://fixture.invalid/realtime",
    socketFactory: async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    protocol: makeProtocol()
  });
  const firstDriver = await transport.connect();
  const staleHandler = sockets[0].listeners("message").at(-1);
  const events = [];
  firstDriver.listen((error, event) => { if (!error) events.push(event); });
  await transport.disconnect();

  const secondDriver = await transport.connect();
  secondDriver.listen((error, event) => { if (!error) events.push(event); });
  staleHandler(Buffer.from("stale-frame"), true);
  sockets[1].emit("message", Buffer.from("fresh-frame"), true);

  assert.deepEqual(events, [{ name: "fixture", args: "fresh-frame" }]);
  await transport.disconnect();
});
