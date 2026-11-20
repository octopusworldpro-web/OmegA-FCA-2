"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractRealtimeConfig } = require("../src/auth/personalSession");

test("extracts account realtime endpoint and sequence from Iris config", () => {
  const html = 'irisSeqID:"987654321",appID:219994525426954,endpoint:"wss://edge-chat.facebook.com/chat?region=ash"';
  assert.deepEqual(extractRealtimeConfig(html), {
    endpoint: "wss://edge-chat.facebook.com/chat?region=ash",
    region: "ash",
    lastSeqId: "987654321"
  });
});

test("extracts endpoint and sequence from serialized MQTT config", () => {
  const html = '"app_id":"219994525426954","endpoint":"wss://edge-chat.facebook.com/chat?region=iad","iris_seq_id":"123456789"';
  assert.deepEqual(extractRealtimeConfig(html), {
    endpoint: "wss://edge-chat.facebook.com/chat?region=iad",
    region: "iad",
    lastSeqId: "123456789"
  });
});

test("rejects broker URLs outside the Facebook Messenger MQTT endpoint", () => {
  const html = 'irisSeqID:"987654321",appID:219994525426954,endpoint:"wss://attacker.example/chat"';
  assert.deepEqual(extractRealtimeConfig(html), {
    endpoint: null,
    region: null,
    lastSeqId: null
  });
});

test("returns empty realtime metadata when no supported config exists", () => {
  assert.deepEqual(extractRealtimeConfig("<html><body>no mqtt bootstrap</body></html>"), {
    endpoint: null,
    region: null,
    lastSeqId: null
  });
});
