"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMqttRequestTracker } = require("../src/transport/mqttRequestTracker");
const mqtt = require("../src/transport/mqtt311Codec");
const { createFacebookMqttProtocol } = require("../src/transport/facebookMqttProtocol");

test("tracks, resolves and removes pending request IDs", async () => {
  const tracker = createMqttRequestTracker({ timeoutMs: 1000 });
  const id = tracker.allocateId();
  const pending = tracker.track(id);
  assert.equal(tracker.pendingCount, 1);
  assert.equal(tracker.resolve({ request_id: id, payload: { ok: true } }), true);
  assert.deepEqual(await pending, { request_id: id, payload: { ok: true } });
  assert.equal(tracker.pendingCount, 0);
  assert.equal(tracker.resolve({ request_id: id }), false);
});

test("times out pending requests and rejects all on disconnect", async () => {
  const tracker = createMqttRequestTracker({ timeoutMs: 20 });
  await assert.rejects(tracker.track(1), error => error.code === "FCA_MQTT_REQUEST_TIMEOUT");
  const first = tracker.track(2);
  const second = tracker.track(3);
  tracker.rejectAll(Object.assign(new Error("closed"), { code: "CLOSED" }));
  await assert.rejects(first, error => error.code === "CLOSED");
  await assert.rejects(second, error => error.code === "CLOSED");
  assert.equal(tracker.pendingCount, 0);
});

test("Messenger protocol sends /ls_req and correlates the matching /ls_resp", async () => {
  const config = createFacebookMqttProtocol({ userId: "123456789" });
  const sent = [];
  const socket = { send: frame => sent.push(Buffer.from(frame)) };
  const pending = config.protocol.request(socket, { type: 3, payload: { tasks: [] } });
  const requestPacket = mqtt.decodePacket(sent[0]);
  assert.equal(requestPacket.topic, "/ls_req");
  const request = JSON.parse(requestPacket.payload.toString());
  assert.equal(typeof request.request_id, "number");
  const response = { request_id: request.request_id, payload: JSON.stringify({ ok: true }) };
  const decoded = config.protocol.decodeFrame(mqtt.encodePublish({
    topic: "/ls_resp", payload: JSON.stringify(response), qos: 0
  }));
  assert.equal(decoded.events[0].matched, true);
  assert.deepEqual(await pending, response);
  assert.equal(config.protocol.getPendingRequestCount(), 0);
});

test("rejects malformed request input and bounds pending requests", async () => {
  const config = createFacebookMqttProtocol({ userId: "123456789", maxPendingRequests: 1, requestTimeoutMs: 100 });
  const socket = { send() {} };
  const pending = config.protocol.request(socket, { type: 3 });
  await assert.rejects(config.protocol.request(socket, { type: 3 }), /pending request limit/);
  config.protocol.closeRequests(new Error("test cleanup"));
  await assert.rejects(pending, /test cleanup/);
});


test("rejects one failed publish without disturbing other pending requests", async () => {
  const tracker = createMqttRequestTracker({ timeoutMs: 1000 });
  const first = tracker.track(1);
  const second = tracker.track(2);
  const failure = Object.assign(new Error("socket send failed"), { code: "SEND_FAILED" });
  assert.equal(tracker.reject(1, failure), true);
  await assert.rejects(first, error => error.code === "SEND_FAILED");
  assert.equal(tracker.pendingCount, 1);
  assert.equal(tracker.resolve({ request_id: 2, payload: { delivered: true } }), true);
  assert.deepEqual(await second, { request_id: 2, payload: { delivered: true } });
  assert.equal(tracker.pendingCount, 0);
  assert.equal(tracker.reject(2, failure), false);
});

test("request ID allocation skips IDs still pending after numeric wrap", async () => {
  const tracker = createMqttRequestTracker({ initialRequestId: Number.MAX_SAFE_INTEGER - 1 });
  const maxId = tracker.allocateId();
  assert.equal(maxId, Number.MAX_SAFE_INTEGER);
  const maxPending = tracker.track(maxId);
  const onePending = tracker.track(1);
  const wrapped = tracker.allocateId();
  assert.equal(wrapped, 2);
  tracker.rejectAll(new Error("cleanup"));
  await assert.rejects(maxPending, /cleanup/);
  await assert.rejects(onePending, /cleanup/);
});
