"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHumanizer } = require("../src/compat/humanizer");

test("humanizer shows typing for the configured delay and then delivers the event", async () => {
  const calls = [];
  const humanizer = createHumanizer({
    sendTypingIndicator: async (threadID, isTyping) => { calls.push([threadID, isTyping]); }
  });
  humanizer.setOptions({ reactDelayMs: 5, cooldownMs: 0, maxPerMinute: 0 });
  const event = { type: "message", threadID: "123456789", messageID: "mid" };
  const received = await new Promise((resolve, reject) => {
    humanizer.processEvent(event, (error, value) => error ? reject(error) : resolve(value));
  });
  assert.equal(received, event);
  assert.deepEqual(calls, [["123456789", true], ["123456789", false]]);
});

test("humanizer supports disabled mode and immediate pass-through", async () => {
  const calls = [];
  const humanizer = createHumanizer({ sendTypingIndicator: async (...args) => calls.push(args) });
  humanizer.setOptions({ enabled: false, reactDelayMs: 100, cooldownMs: 0 });
  const event = { type: "message", threadID: "123456789" };
  const received = await new Promise(resolve => humanizer.processEvent(event, (_error, value) => resolve(value)));
  assert.equal(received, event);
  assert.equal(calls.length, 0);
  humanizer.enabled = true;
  assert.equal(humanizer.getOptions().enabled, true);
});

test("humanizer enforces per-thread cooldown and skips E2EE events", async () => {
  const calls = [];
  const humanizer = createHumanizer({ sendTypingIndicator: async (...args) => calls.push(args) });
  humanizer.setOptions({ reactDelayMs: 1, cooldownMs: 60000, maxPerMinute: 0, perThread: true });
  const event = { type: "message", threadID: "123456789" };
  await new Promise(resolve => humanizer.processEvent(event, () => resolve()));
  await new Promise(resolve => humanizer.processEvent(event, () => resolve()));
  await new Promise(resolve => humanizer.processEvent({ ...event, isE2EE: true }, () => resolve()));
  assert.deepEqual(calls, [["123456789", true], ["123456789", false]]);
});

test("humanizer validates timing and rate-limit options", () => {
  const humanizer = createHumanizer();
  assert.throws(() => humanizer.setOptions({ reactDelayMs: [10, 5] }), /greater than or equal/);
  assert.throws(() => humanizer.setOptions({ maxPerMinute: -1 }), /between 0 and 1000/);
  assert.throws(() => humanizer.setOptions({ perThread: "yes" }), /boolean/);
});
