"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mqtt = require("../src/transport/mqtt311Codec");
const { createFacebookMqttProtocol } = require("../src/transport/facebookMqttProtocol");

test("uses the account sequence cursor in the initial Messenger sync queue", async () => {
  const configured = createFacebookMqttProtocol({
    userId: "123456789",
    clientId: "omega-test-client",
    deviceId: "omega-test-device",
    sessionId: 1234,
    url: "wss://edge-chat.facebook.com/chat?region=ash",
    region: "ash",
    lastSeqId: "987654321",
    keepAlive: 0
  });
  assert.match(configured.url, /region=ash/);
  const sent = [];
  const socket = { send(frame) { sent.push(Buffer.from(frame)); } };
  let subackPacketId;
  await configured.protocol.subscribe(socket, {
    async waitForFrame() {
      const remaining = mqtt.decodeRemainingLength(sent[0]);
      subackPacketId = sent[0].readUInt16BE(remaining.offset);
      return Buffer.from([0x90, 0x03, subackPacketId >> 8, subackPacketId & 0xff, 0x01]);
    }
  });
  const publishes = sent.slice(1).map(frame => mqtt.decodePacket(frame)).filter(packet => packet.type === "publish");
  const queue = publishes.find(packet => packet.topic === "/messenger_sync_create_queue");
  assert.ok(queue, "initial sync queue publish should be sent");
  const payload = JSON.parse(queue.payload.toString("utf8"));
  assert.equal(payload.initial_titan_sequence_id, "987654321");
  assert.equal(payload.entity_fbid, "123456789");
});
