"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFacebookThreadApi } = require("../src/transport/facebookThreadApi");

const session = { userId: "123456789012345" };

test("remaining FCA receipt methods use observed Messenger endpoints and payloads", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body });
    return { payload: { success: true } };
  } } });
  await api.markAsReadAll();
  await api.markAsSeen(1700000000000);
  assert.equal(calls[0].url, "https://www.facebook.com/ajax/mercury/mark_folder_as_read.php");
  assert.deepEqual(calls[0].body, { folder: "inbox" });
  assert.equal(calls[1].url, "https://www.facebook.com/ajax/mercury/mark_seen.php");
  assert.deepEqual(calls[1].body, { seen_timestamp: 1700000000000 });
});

test("deleteMessage and deleteThread preserve distinct delete-for-me semantics", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body });
    return { payload: { success: true } };
  } } });
  await api.deleteMessage("mid.123");
  await api.deleteThread(["123456789012345", "987654321098765"]);
  assert.equal(calls[0].url, "https://www.facebook.com/ajax/mercury/delete_messages.php");
  assert.deepEqual(calls[0].body, { "message_ids[0]": "mid.123" });
  assert.equal(calls[1].url, "https://www.facebook.com/ajax/mercury/delete_thread.php");
  assert.deepEqual(calls[1].body, {
    client: "mercury", "ids[0]": "123456789012345", "ids[1]": "987654321098765"
  });
});

test("muteThread and changeArchivedStatus accept legacy FCA argument shapes", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body });
    return { payload: { success: true } };
  } } });
  await api.muteThread("123456789012345", 3600);
  await api.changeArchivedStatus(["123456789012345", "987654321098765"], true);
  assert.equal(calls[0].url, "https://www.facebook.com/ajax/mercury/change_mute_thread.php");
  assert.deepEqual(calls[0].body, { thread_fbid: "123456789012345", mute_settings: 3600 });
  assert.equal(calls[1].url, "https://www.facebook.com/ajax/mercury/change_archived_status.php");
  assert.deepEqual(calls[1].body, { "ids[123456789012345]": true, "ids[987654321098765]": true });
});

test("remaining FCA methods validate input and reject Facebook-declared failures", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: { error: 1 } }) } });
  assert.throws(() => api.markAsSeen(-1), /non-negative integer/);
  assert.throws(() => api.deleteMessage(""), /messageID is invalid/);
  assert.throws(() => api.deleteThread([]), /1 to 100/);
  assert.throws(() => api.muteThread("bad", 60), /numeric Facebook ID/);
  assert.throws(() => api.muteThread("123456789012345", 1.5), /muteSeconds/);
  assert.throws(() => api.changeArchivedStatus("123456789012345", "yes"), /archive must be a boolean/);
  await assert.rejects(api.markAsReadAll(), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.markAsSeen(), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.deleteMessage("mid.123"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.deleteThread("123456789012345"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.muteThread("123456789012345", 0), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.changeArchivedStatus("123456789012345", false), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});

test("markAsSeen accepts callback as its first argument", async () => {
  let captured;
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    captured = { url, body };
    return { payload: { success: true } };
  } } });
  await new Promise((resolve, reject) => api.markAsSeen((error) => error ? reject(error) : resolve()));
  assert.equal(captured.url, "https://www.facebook.com/ajax/mercury/mark_seen.php");
  assert.ok(Number.isSafeInteger(captured.body.seen_timestamp));
});
