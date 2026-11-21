"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBroadcastSender } = require("../src/compat/broadcast");

test("sendBroadcast delivers bounded parallel batches and reports partial failures", async () => {
  const calls = [];
  const progress = [];
  const sendBroadcast = createBroadcastSender({ sendMessage: async (message, threadID) => {
    calls.push({ message, threadID });
    if (threadID === "222222222222222") throw new Error("simulated failure");
    return { messageID: "mid-" + threadID };
  } });
  const result = await sendBroadcast("hello", [
    "111111111111111", "222222222222222", "333333333333333"
  ], { delay: 0, parallel: 2, onEach: (error, info, id) => progress.push({ failed: Boolean(error), id }) });
  assert.equal(result.total, 3);
  assert.deepEqual(result.sent.map(item => item.threadID), ["111111111111111", "333333333333333"]);
  assert.deepEqual(result.failed.map(item => item.threadID), ["222222222222222"]);
  assert.equal(calls.length, 3);
  assert.equal(progress.length, 3);
  assert.equal(progress.find(item => item.id === "222222222222222").failed, true);
});

test("sendBroadcast validates recipients, message, pacing and callback overload", async () => {
  const sendBroadcast = createBroadcastSender({ sendMessage: async (_message, id) => ({ id }) });
  assert.throws(() => sendBroadcast("x", []), /1 to 100/);
  assert.throws(() => sendBroadcast("x", ["bad"]), /numeric Facebook ID/);
  assert.throws(() => sendBroadcast("x", ["111111111111111", "111111111111111"]), /unique/);
  assert.throws(() => sendBroadcast(null, ["111111111111111"]), /message must/);
  assert.throws(() => sendBroadcast("x", ["111111111111111"], { delay: -1 }), /delay/);
  assert.throws(() => sendBroadcast("x", ["111111111111111"], { parallel: 6 }), /parallel/);
  let callbackResult;
  await new Promise((resolve, reject) => sendBroadcast("hello", "111111111111111", (error, result) => {
    if (error) return reject(error);
    callbackResult = result;
    resolve();
  }));
  assert.equal(callbackResult.total, 1);
  assert.equal(callbackResult.sent.length, 1);
});
