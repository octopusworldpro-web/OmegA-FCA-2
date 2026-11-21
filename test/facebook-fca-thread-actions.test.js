"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFacebookThreadApi } = require("../src/transport/facebookThreadApi");

const session = { userId: "123456789012345", request: async () => { throw new Error("unused"); } };

test("changeAdminStatus and createPoll use documented FCA request contracts", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body });
    return { payload: { payload: { status: "success" } } };
  } } });
  await api.changeAdminStatus("123456789012345", ["111111111111111", "222222222222222"], true);
  await api.createPoll("Choose", "123456789012345", { A: false, B: true });
  assert.equal(calls[0].url, "https://www.facebook.com/messaging/save_admins/?dpr=1");
  assert.deepEqual(calls[0].body, {
    thread_fbid: "123456789012345", add: true,
    "admin_ids[0]": "111111111111111", "admin_ids[1]": "222222222222222"
  });
  assert.equal(calls[1].url, "https://www.facebook.com/messaging/group_polling/create_poll/?dpr=1");
  assert.deepEqual(calls[1].body, {
    target_id: "123456789012345", question_text: "Choose",
    "option_text_array[0]": "A", "option_is_selected_array[0]": "0",
    "option_text_array[1]": "B", "option_is_selected_array[1]": "1"
  });
});

test("handleMessageRequest moves one or more requests to inbox or other", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body }); return { payload: { success: true } };
  } } });
  await api.handleMessageRequest(["111111111111111", "222222222222222"], true);
  await api.handleMessageRequest("111111111111111", false);
  assert.equal(calls[0].url, "https://www.facebook.com/ajax/mercury/move_thread.php");
  assert.deepEqual(calls[0].body, {
    client: "mercury", "inbox[0]": "111111111111111", "inbox[1]": "222222222222222"
  });
  assert.deepEqual(calls[1].body, { client: "mercury", "other[0]": "111111111111111" });
});

test("searchForThread normalizes returned thread metadata", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    assert.equal(url, "https://www.facebook.com/ajax/mercury/search_threads.php");
    assert.equal(body.query, "test group");
    return { payload: { payload: { mercury_payload: { threads: [{
      threadID: "333333333333333", name: "Test Group", unreadCount: 1,
      all_participants: { nodes: [{ messaging_actor: { id: "111111111111111", name: "Alice" } }] }
    }] } } } };
  } } });
  const found = await api.searchForThread("test group");
  assert.equal(found[0].threadID, "333333333333333");
  assert.equal(found[0].name, "Test Group");
});

test("getThreadPictures retrieves bounded shared-photo metadata and detail", async () => {
  let count = 0;
  const photo = { uri: "https://scontent.xx.fbcdn.net/photo.jpg", width: 640, height: 480 };
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    count++;
    if (count === 1) {
      assert.equal(url, "https://www.facebook.com/ajax/messaging/attachments/sharedphotos.php");
      assert.deepEqual(body, { thread_id: "123456789012345", offset: 0, limit: 5 });
      return { payload: { payload: { imagesData: [{ fbid: "987654321" }] } } };
    }
    assert.deepEqual(body, { thread_id: "123456789012345", image_id: "987654321" });
    const data = {
      query_metadata: { query_path: [{ message_thread: "message_thread" }] },
      query_results: { message_thread: { message_images: { edges: [{ node: { image2: photo } }] } } }
    };
    return { payload: { jsmods: { require: [[null, null, null, [null, data]]] } } };
  } } });
  const result = await api.getThreadPictures("123456789012345", 0, 5);
  assert.deepEqual(result, [photo]);
  assert.equal(count, 2);
});

test("new group methods validate arguments and surface Facebook failures", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: { error: 1 } }) } });
  assert.throws(() => api.changeAdminStatus("bad", "111111111111111", true), /numeric Facebook ID/);
  assert.throws(() => api.changeAdminStatus("123456789012345", "111111111111111", "yes"), /boolean/);
  assert.throws(() => api.createPoll("", "123456789012345"), /poll title/);
  assert.throws(() => api.createPoll("Poll", "123456789012345", { A: "yes" }), /boolean selected/);
  assert.throws(() => api.handleMessageRequest("123456789012345", 1), /boolean/);
  assert.throws(() => api.searchForThread(""), /non-empty search/);
  assert.throws(() => api.getThreadPictures("123456789012345", -1, 5), /offset/);
  await assert.rejects(api.changeAdminStatus("123456789012345", "111111111111111", true), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.createPoll("Poll", "123456789012345"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.handleMessageRequest("123456789012345", true), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});
