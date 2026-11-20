"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMessengerSyncPayload, normalizeMessengerDelta } = require("../src/transport/facebookMqttEvents");
const mqtt = require("../src/transport/mqtt311Codec");
const { createFacebookMqttProtocol } = require("../src/transport/facebookMqttProtocol");

test("normalizes known Messenger message deltas and preserves source fields", () => {
  const delta = {
    class: "NewMessage",
    messageMetadata: {
      messageId: "mid.1", actorFbId: "123456789", timestamp: 1700000000000,
      threadKey: { threadFbId: "987654321" }
    },
    body: "hello",
    attachments: []
  };
  const result = normalizeMessengerDelta(delta);
  assert.equal(result.type, "message");
  assert.equal(result.threadID, "987654321");
  assert.equal(result.messageID, "mid.1");
  assert.equal(result.senderID, "123456789");
  assert.equal(result.body, "hello");
  assert.equal(result.isGroup, true);
  assert.equal(result.rawDelta, delta);
});

test("normalizes reply, reaction, unsend, typing, read and presence delta classes", () => {
  assert.equal(normalizeMessengerDelta({ class: "NewMessage", replyToMessageId: "mid.x" }).type, "message_reply");
  assert.equal(normalizeMessengerDelta({ class: "MessageReaction", reaction: "❤️" }).type, "message_reaction");
  assert.equal(normalizeMessengerDelta({ class: "MessageUnsend" }).type, "message_unsend");
  assert.equal(normalizeMessengerDelta({ class: "Typing" }).type, "typ");
  assert.equal(normalizeMessengerDelta({ class: "ReadReceipt" }).type, "read");
  assert.equal(normalizeMessengerDelta({ class: "PresenceUpdate" }).type, "presence");
  assert.equal(normalizeMessengerDelta({ class: "FutureDelta" }).type, "unknown_delta");
});

test("normalizes numeric Facebook identifiers to strings", () => {
  const result = normalizeMessengerDelta({
    class: "NewMessage",
    messageMetadata: {
      messageId: 1234567890123,
      actorFbId: 123456789,
      threadKey: { threadFbId: 987654321 }
    },
    body: "numeric ids"
  });
  assert.equal(result.messageID, "1234567890123");
  assert.equal(result.senderID, "123456789");
  assert.equal(result.threadID, "987654321");
  assert.equal(result.isGroup, true);
});

test("extracts bounded delta arrays and known sync cursor fields", () => {
  const result = parseMessengerSyncPayload({
    deltas: [{ class: "NewMessage", body: "hi" }],
    sync_token: "opaque-token",
    last_seq_id: "42"
  });
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.cursor, { syncToken: "opaque-token", lastSeqId: "42" });
  assert.equal(parseMessengerSyncPayload(Buffer.from("{")).events.length, 0);
  const referenceShape = parseMessengerSyncPayload({
    deltas: [], firstDeltaSeqId: "100", lastIssuedSeqId: "105", syncToken: "reference-token"
  });
  assert.deepEqual(referenceShape.cursor, { syncToken: "reference-token", lastSeqId: "105" });
});

test("Messenger MQTT /t_ms frames emit normalized events and cursor updates", () => {
  const config = createFacebookMqttProtocol({ userId: "123456789" });
  const frame = mqtt.encodePublish({
    topic: "/t_ms",
    payload: JSON.stringify({
      deltas: [{ class: "NewMessage", messageMetadata: { messageId: "m1" }, body: "hi" }],
      sync_token: "opaque",
      last_seq_id: 9
    }),
    qos: 0
  });
  const result = config.protocol.decodeFrame(frame);
  assert.equal(result.events[0].type, "message");
  assert.equal(result.events[1].type, "sync_cursor");
  assert.equal(result.events[1].cursor.lastSeqId, 9);
});
