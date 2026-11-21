"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFacebookThreadApi } = require("../src/transport/facebookThreadApi");

const session = { userId: "123456789012345" };

test("changeBlockedStatus and unfriend use authenticated account actions", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body }); return { payload: { success: true } };
  } } });
  await api.changeBlockedStatus("111111111111111", true);
  await api.changeBlockedStatus("111111111111111", false);
  await api.unfriend("111111111111111");
  assert.equal(calls[0].url, "https://www.facebook.com/messaging/block_messages/");
  assert.deepEqual(calls[0].body, { fbid: "111111111111111" });
  assert.equal(calls[1].url, "https://www.facebook.com/messaging/unblock_messages/");
  assert.equal(calls[2].url, "https://www.facebook.com/ajax/profile/removefriendconfirm.php");
  assert.equal(calls[2].body.uid, "111111111111111");
  assert.match(calls[2].body["nctr[_mod]"], /123456789012345/);
});

test("changeBio sends authenticated profile mutation and supports callback overload", async () => {
  let captured;
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    captured = { url, body }; return { payload: { data: { profile_comet_set_bio: { success: true } } } };
  } } });
  await new Promise((resolve, reject) => api.changeBio("Hello FCA", true, error => error ? reject(error) : resolve()));
  assert.equal(captured.url, "https://www.facebook.com/api/graphql/");
  assert.equal(captured.body.fb_api_req_friendly_name, "ProfileCometSetBioMutation");
  const variables = JSON.parse(captured.body.variables);
  assert.equal(variables.input.actor_id, session.userId);
  assert.equal(variables.input.bio, "Hello FCA");
  assert.equal(variables.input.publish_bio_feed_story, true);
});

test("getEmojiUrl computes the Facebook emoji asset URL and validates inputs", () => {
  const api = createFacebookThreadApi({ session, webClient: {} });
  assert.equal(api.getEmojiUrl("👍", 64, "1.0"), "https://static.xx.fbcdn.net/images/emoji.php/v8/z" +
    (function () {
      const ending = "1.0/64/1f44d.png";
      let hash = 317426846;
      for (let i = 0; i < ending.length; i++) hash = (Math.imul(hash, 31) + ending.charCodeAt(i)) | 0;
      return (hash & 255).toString(16);
    })() + "/1.0/64/1f44d.png");
  assert.throws(() => api.getEmojiUrl("ab"), /one emoji/);
  assert.throws(() => api.getEmojiUrl("👍", 16), /32, 64, or 128/);
  assert.throws(() => api.getEmojiUrl("👍", 64, "2.0"), /pixelRatio/);
});

test("account actions validate inputs and reject Facebook-declared failures", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: { error: 1 } }) } });
  assert.throws(() => api.changeBlockedStatus("bad", true), /numeric Facebook ID/);
  assert.throws(() => api.changeBlockedStatus("111111111111111", 1), /boolean/);
  assert.throws(() => api.changeBio("bio", "yes"), /publish must be a boolean/);
  assert.throws(() => api.changeBio("x".repeat(102)), /up to 101/);
  await assert.rejects(api.changeBlockedStatus("111111111111111", true), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.changeBio("bio"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.unfriend("111111111111111"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});
