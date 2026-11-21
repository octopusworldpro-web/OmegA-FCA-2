"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFacebookThreadApi } = require("../src/transport/facebookThreadApi");

const session = { userId: "123456789012345", request: async () => { throw new Error("unused"); } };
const person = { messaging_actor: { id: "987654321", name: "Test User", big_image_src: { uri: "https://example.test/avatar" } } };
const thread = {
  thread_key: { other_user_id: "987654321" }, name: null, unread_count: 2, messages_count: 8,
  all_participants: { nodes: [person] }, thread_admins: [], thread_type: "ONE_TO_ONE",
  updated_time_precise: "1700000000000", customization_info: { participant_customizations: [] },
  last_message: { nodes: [{ snippet: "hello", timestamp_precise: "1700000000000", message_sender: { messaging_actor: { id: "987654321" } } }] }
};
function batch(data) { return [{ o0: { data } }, { error_results: 0, successful_results: 1 }]; }

test("Thread APIs serialize classic FCA requests and normalize thread list/info/history", async () => {
  const calls = [];
  const webClient = { post: async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith("/api/graphqlbatch/")) {
      const query = JSON.parse(body.queries).o0;
      if (query.doc_id === "1349387578499440") return { payload: batch({ viewer: { message_threads: { nodes: [thread] } } }) };
      if (query.query_params.load_messages) return { payload: batch({ message_thread: {
        thread_type: "ONE_TO_ONE",
        messages: { nodes: [{ __typename: "UserMessage", message_id: "m-1", message_sender: { id: "987654321" },
          timestamp_precise: "1700000000001", message: { text: "hello", ranges: [] }, blob_attachments: [] }] }
      } }) };
      return { payload: batch({ message_thread: thread }) };
    }
    return { payload: {} };
  } };
  const api = createFacebookThreadApi({ session, webClient });
  const list = await api.getThreadList(10, null, ["INBOX"]);
  assert.equal(list[0].threadID, "987654321");
  assert.equal(list[0].name, "Test User");
  const info = await api.getThreadInfo("987654321");
  assert.equal(info.unreadCount, 2);
  const history = await api.getThreadHistory("987654321", 20);
  assert.equal(history[0].body, "hello");
  assert.equal(history[0].messageID, "m-1");
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[0].body.queries).o0.query_params.limit, 10);
});

test("getUserInfo batches IDs and maps the legacy FCA profile shape", async () => {
  let captured;
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    captured = { url, body };
    return { payload: { payload: { profiles: { "987654321": {
      name: "Test User", firstName: "Test", uri: "https://facebook.com/test", is_friend: true
    } } } } };
  } } });
  const result = await api.getUserInfo(["987654321"]);
  assert.equal(result["987654321"].name, "Test User");
  assert.equal(result["987654321"].isFriend, true);
  assert.equal(captured.body["ids[0]"], "987654321");
});

test("group actions, reactions and read receipts use public FCA request shapes", async () => {
  const calls = [];
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body }); return { payload: { success: true } };
  } } });
  await api.addUserToGroup("987654321", "123456789012345");
  await api.removeUserFromGroup("987654321", "123456789012345");
  await api.changeNickname("Tester", "123456789012345", "987654321");
  await api.setMessageReaction(":love:", "mid.1");
  await api.markAsRead("123456789012345");
  assert.equal(calls.length, 5);
  assert.equal(calls[0].body["log_message_data[added_participants][0]"], "fbid:987654321");
  assert.equal(calls[1].body.uid, "987654321");
  assert.equal(calls[2].body.nickname, "Tester");
  assert.match(calls[3].body.variables, /ADD_REACTION/);
  assert.equal(calls[4].body["ids[123456789012345]"], true);
});

test("Thread API validates identifiers and supports error-first callbacks", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: batch({}) }) } });
  assert.throws(() => api.getThreadInfo("not-an-id"), /numeric Facebook ID/);
  let callbackError;
  api.getThreadInfo("123456789012345", error => { callbackError = error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(callbackError instanceof Error);
});

test("httpPost preserves authenticated Facebook response text for GoatBot legacy commands", async () => {
  let captured;
  const raw = '{"data":{"viewer":{"friending_possibilities":{"edges":[]}}}}';
  const api = createFacebookThreadApi({
    session,
    webClient: {
      post: async (url, form) => {
        captured = { url, form };
        return { raw, payload: JSON.parse(raw) };
      }
    }
  });
  const response = await api.httpPost("https://www.facebook.com/api/graphql/", { doc_id: "123", variables: "{}" });
  assert.equal(response, raw);
  assert.equal(captured.url, "https://www.facebook.com/api/graphql/");
  assert.equal(captured.form.doc_id, "123");
});

test("httpPost supports error-first callbacks and rejects non-object forms", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async () => ({ raw: "ok" }) }
  });
  assert.throws(() => api.httpPost("https://www.facebook.com/api/graphql/", "not-an-object"), /form must be an object/);
  let result;
  api.httpPost("https://www.facebook.com/api/graphql/", {}, (error, value) => {
    assert.equal(error, null);
    result = value;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result, "ok");
});

test("unsendMessage uses the authenticated Facebook unsend endpoint", async () => {
  let captured;
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      captured = { url, body };
      return { payload: { success: true } };
    } }
  });
  const result = await api.unsendMessage("mid.123");
  assert.equal(captured.url, "https://www.facebook.com/messaging/unsend_message/");
  assert.deepEqual(captured.body, { message_id: "mid.123" });
  assert.deepEqual(result, { success: true });
});

test("unsendMessage rejects invalid IDs and reports Facebook action errors", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async () => ({ payload: { error: "rejected" } }) }
  });
  assert.throws(() => api.unsendMessage(""), /messageID is invalid/);
  await assert.rejects(api.unsendMessage("mid.123"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});

test("thread title, color and emoji actions use the authenticated customization endpoints", async () => {
  const calls = [];
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      calls.push({ url, body });
      return { payload: { success: true } };
    } }
  });
  await api.setTitle("Test Group", "123456789012345");
  await api.changeThreadColor("196241301102133", "123456789012345");
  await api.changeThreadEmoji("🎉", "123456789012345");
  assert.equal(calls[0].url, "https://www.facebook.com/messaging/set_thread_name/");
  assert.equal(calls[0].body.thread_name, "Test Group");
  assert.equal(calls[0].body.thread_fbid, "123456789012345");
  assert.match(calls[0].body.offline_threading_id, /^[0-9]{10,24}$/);
  assert.match(calls[0].body.threading_id, /^<[0-9]+:[0-9]+-omega-fca@mail[.]projektitan[.]com>$/);
  assert.equal(calls[1].url, "https://www.facebook.com/messaging/save_thread_color/?source=thread_settings&dpr=1");
  assert.equal(calls[1].body.color_choice, "");
  assert.equal(calls[2].url, "https://www.facebook.com/messaging/save_thread_emoji/?source=thread_settings&dpr=1");
  assert.equal(calls[2].body.emoji_choice, "🎉");
});

test("thread customization methods validate input and normalize Facebook errors", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async () => ({ payload: { error: 1545012 } }) }
  });
  assert.throws(() => api.setTitle("x", "bad"), /numeric Facebook ID/);
  assert.throws(() => api.changeThreadColor("x".repeat(65), "123456789012345"), /theme ID/);
  assert.throws(() => api.changeThreadEmoji("x".repeat(17), "123456789012345"), /up to 16/);
  await assert.rejects(api.setTitle("Test", "123456789012345"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.changeThreadColor("#ff0000", "123456789012345"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
  await assert.rejects(api.changeThreadEmoji("🎉", "123456789012345"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});

test("sendTypingIndicator sends start and stop requests to the Messenger typing endpoint", async () => {
  const calls = [];
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      calls.push({ url, body });
      if (url === "https://www.facebook.com/chat/user_info/") {
        return { payload: { payload: { profiles: { "123456789012345": { name: "Test" } } } } };
      }
      return { payload: { success: true } };
    } }
  });
  await api.sendTypingIndicator("123456789012345", true);
  await api.sendTypingIndicator("123456789012345", false);
  await api.sendTypingIndicator(1, "123456789012345", undefined, false);
  const typingCalls = calls.filter(call => call.url === "https://www.facebook.com/ajax/messaging/typ.php");
  assert.equal(typingCalls.length, 3);
  assert.equal(typingCalls[0].body.typ, 1);
  assert.equal(typingCalls[0].body.thread, "123456789012345");
  assert.equal(typingCalls[0].body.to, "123456789012345");
  assert.equal(typingCalls[1].body.typ, 0);
  assert.equal(typingCalls[2].body.typ, 1);
  assert.equal(typingCalls[2].body.to, "123456789012345");
});

test("sendTypingIndicator validates thread and state", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: {} }) } });
  assert.throws(() => api.sendTypingIndicator("", true), /numeric Facebook ID/);
  assert.throws(() => api.sendTypingIndicator("123456789012345", "yes"), /typing must be a boolean/);
});

test("sendTypingIndicator accepts callback as the second argument", async () => {
  let completed = false;
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async url => url === "https://www.facebook.com/chat/user_info/" ? ({ payload: { payload: { profiles: { "123456789012345": { name: "Test" } } } } }) : ({ payload: { success: true } }) }
  });
  api.sendTypingIndicator("123456789012345", error => {
    assert.equal(error, null);
    completed = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true);
});

test("markAsDelivered sends the message and thread receipt fields", async () => {
  let captured;
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      captured = { url, body };
      return { payload: { success: true } };
    } }
  });
  await api.markAsDelivered("123456789012345", "mid.123");
  assert.equal(captured.url, "https://www.facebook.com/ajax/mercury/delivery_receipts.php");
  assert.equal(captured.body["message_ids[0]"], "mid.123");
  assert.equal(captured.body["thread_ids[123456789012345][0]"], "mid.123");
});

test("markAsDelivered validates IDs and normalizes rejected receipts", async () => {
  const api = createFacebookThreadApi({ session, webClient: { post: async () => ({ payload: { error: 1 } }) } });
  assert.throws(() => api.markAsDelivered("", "mid.123"), /numeric Facebook ID/);
  await assert.rejects(api.markAsDelivered("123456789012345", "mid.123"), error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED");
});


test("getMessage resolves a message from normalized thread history and supports not-found", async () => {
  let calls = 0;
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      calls++;
      const query = JSON.parse(body.queries).o0;
      assert.equal(query.query_params.id, "987654321");
      return { payload: batch({ message_thread: {
        thread_type: "ONE_TO_ONE",
        messages: { nodes: [{
          __typename: "UserMessage", message_id: "mid.target",
          message_sender: { id: "987654321" },
          timestamp_precise: "1700000000001",
          message: { text: "target message", ranges: [] }, blob_attachments: []
        }] }
      } }) };
    } }
  });
  const found = await api.getMessage("987654321", "mid.target");
  assert.equal(found.messageID, "mid.target");
  assert.equal(found.body, "target message");
  const missing = await api.getMessage("987654321", "mid.missing");
  assert.equal(missing, null);
  assert.equal(calls, 2);
  assert.throws(() => api.getMessage("bad", "mid.target"), /numeric Facebook ID/);
  assert.throws(() => api.getMessage("987654321", ""), /messageID is invalid/);
});


test("getUserID and getUID resolve Facebook profile names and URLs", async () => {
  const calls = [];
  const api = createFacebookThreadApi({
    session,
    webClient: { get: async (url, options) => {
      calls.push({ url, options });
      return { payload: { payload: { entries: [{
        uid: "111111111111111",
        photo: "https://scontent.xx.fbcdn.net/photo.jpg",
        index_rank: 1, text: "Alice Example", is_verified: false,
        path: "/alice.example", category: "user", score: 100, type: "user"
      }] } } };
    } }
  });
  const entries = await api.getUserID("Alice Example");
  assert.equal(entries[0].userID, "111111111111111");
  assert.equal(entries[0].name, "Alice Example");
  const resolved = await api.getUID("https://www.facebook.com/alice.example");
  assert.equal(resolved, "111111111111111");
  assert.equal(await api.getUID("https://www.facebook.com/profile.php?id=222222222222222"), "222222222222222");
  assert.equal(await api.getUID("333333333333333"), "333333333333333");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://www.facebook.com/ajax/typeahead/search.php");
  assert.equal(calls[0].options.query.viewer, session.userId);
  assert.equal(calls[0].options.query.value, "alice example");
  assert.throws(() => api.getUID("https://evil.example/alice"), /facebook.com/);
});

test("resolvePhotoUrl extracts only HTTPS Facebook CDN photo URLs", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { get: async (url, options) => {
      assert.equal(url, "https://www.facebook.com/mercury/attachments/photo");
      assert.equal(options.query.photo_id, "123456789012345");
      return { payload: { jsmods: { require: [[null, null, null, ["https://scontent.xx.fbcdn.net/photo.jpg"]]] } } };
    } }
  });
  assert.equal(await api.resolvePhotoUrl("123456789012345"), "https://scontent.xx.fbcdn.net/photo.jpg");
  const bad = createFacebookThreadApi({
    session,
    webClient: { get: async () => ({ payload: { jsmods: { require: [[null, null, null, ["https://evil.example/photo.jpg"]]] } } }) }
  });
  await assert.rejects(bad.resolvePhotoUrl("123456789012345"), /approved CDN hosts/);
});

test("getFriendsList normalizes friend metadata", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body, options) => {
      assert.equal(url, "https://www.facebook.com/chat/user_info_all");
      assert.equal(options.query.viewer, session.userId);
      return { payload: { payload: {
        a: { id: "111111111111111", name: "Alice", firstName: "Alice", gender: 2, is_friend: true, thumbSrc: "https://scontent.xx.fbcdn.net/a.jpg" },
        b: { id: "222222222222222", name: "Bob", gender: 1, is_friend: true }
      } } };
    } }
  });
  const friends = await api.getFriendsList();
  assert.equal(friends.length, 2);
  assert.equal(friends[0].userID, "111111111111111");
  assert.equal(friends[0].gender, "male_singular");
  assert.equal(friends[1].gender, "female_singular");
});

test("createNewGroup sends the observed GraphQL mutation and returns its thread ID", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, form) => {
      assert.equal(url, "https://www.facebook.com/api/graphql/");
      assert.equal(form.fb_api_req_friendly_name, "MessengerGroupCreateMutation");
      const variables = JSON.parse(form.variables);
      assert.equal(variables.input.actor_id, session.userId);
      assert.equal(variables.input.entry_point, "jewel_new_group");
      assert.equal(variables.input.thread_settings.name, "OmegA Group");
      assert.deepEqual(variables.input.participants, [
        { fbid: "111111111111111" }, { fbid: "222222222222222" }, { fbid: session.userId }
      ]);
      return { payload: { data: { messenger_group_thread_create: {
        thread: { thread_key: { thread_fbid: "333333333333333" } }
      } } } };
    } }
  });
  assert.equal(await api.createNewGroup(["111111111111111", "222222222222222"], "OmegA Group"), "333333333333333");
});


test("legacy sendTypingIndicator returns an idempotent stop function", async () => {
  const calls = [];
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async (url, body) => {
      calls.push({ url, body: { ...body } });
      if (url === "https://www.facebook.com/chat/user_info/") {
        return { payload: { payload: { profiles: {
          "987654321": { name: "Test User" }
        } } } };
      }
      return { payload: { success: true } };
    } }
  });
  const stopTyping = await api.sendTypingIndicator("987654321");
  assert.equal(typeof stopTyping, "function");
  await stopTyping();
  await stopTyping();
  const typingCalls = calls.filter(call => call.url === "https://www.facebook.com/ajax/messaging/typ.php");
  assert.deepEqual(typingCalls.map(call => call.body.typ), [1, 0]);
});


test("httpGet performs authenticated query requests and preserves response text", async () => {
  let captured;
  const raw = '{"payload":{"entries":[]}}';
  const api = createFacebookThreadApi({
    session,
    webClient: { get: async (url, options) => {
      captured = { url, options };
      return { raw, payload: {} };
    } }
  });
  const result = await api.httpGet("https://www.facebook.com/ajax/typeahead/search.php", { value: "alice" });
  assert.equal(result, raw);
  assert.equal(captured.url, "https://www.facebook.com/ajax/typeahead/search.php");
  assert.deepEqual(captured.options.query, { value: "alice" });
});

test("httpGet supports callbacks and rejects invalid query values", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { get: async () => ({ raw: "ok", payload: {} }) }
  });
  assert.throws(() => api.httpGet("https://www.facebook.com/", "not-an-object"), /query must be an object/);
  let value;
  api.httpGet("https://www.facebook.com/", (error, result) => {
    assert.equal(error, null);
    value = result;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value, "ok");
});


test("setMessageReaction and markAsRead reject Facebook-declared action failures", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async () => ({ payload: { error: 1545012 } }) }
  });
  await assert.rejects(api.setMessageReaction("👍", "mid.failure"), error =>
    error.code === "FCA_FACEBOOK_REQUEST_REJECTED" && error.retryable === false);
  await assert.rejects(api.markAsRead("123456789012345"), error =>
    error.code === "FCA_FACEBOOK_REQUEST_REJECTED" && error.retryable === false);
});

test("markAsRead forwards Facebook failures through its legacy callback", async () => {
  const api = createFacebookThreadApi({
    session,
    webClient: { post: async () => ({ payload: { error: 1 } }) }
  });
  let callbackError;
  api.markAsRead("123456789012345", error => { callbackError = error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(callbackError?.code, "FCA_FACEBOOK_REQUEST_REJECTED");
});

test("getThreadList paginates large legacy limits in bounded batches", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...thread,
    thread_key: { other_user_id: String(987654321 + index) },
    updated_time_precise: String(1700000000000 - index * 1000)
  }));
  const nextThread = {
    ...thread,
    thread_key: { other_user_id: "999999999" },
    updated_time_precise: "1699999899000"
  };
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    const params = JSON.parse(body.queries).o0.query_params;
    calls.push(params);
    return { payload: batch({ viewer: { message_threads: { nodes: params.before == null ? firstPage : [firstPage.at(-1), nextThread] } } }) };
  } } });
  const result = await api.getThreadList(101, null, "INBOX");
  assert.equal(result.length, 101);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].limit, 100);
  assert.equal(calls[1].limit, 2);
  assert.equal(calls[1].tags[0], "INBOX");
});

test("getThreadHistory paginates legacy requests above one GraphQL page", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    __typename: "UserMessage",
    message_id: "mid." + index,
    message_sender: { id: "987654321" },
    timestamp_precise: String(1700000000000 - index * 1000),
    message: { text: "message " + index, ranges: [] },
    blob_attachments: []
  }));
  const nextMessage = {
    __typename: "UserMessage",
    message_id: "mid.100",
    message_sender: { id: "987654321" },
    timestamp_precise: "1699999899000",
    message: { text: "message 100", ranges: [] },
    blob_attachments: []
  };
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    const params = JSON.parse(body.queries).o0.query_params;
    calls.push(params);
    const nodes = params.before == null ? firstPage : [firstPage.at(-1), nextMessage];
    return { payload: batch({ message_thread: { thread_type: "ONE_TO_ONE", messages: { nodes } } }) };
  } } });
  const result = await api.getThreadHistory("123456789012345", 101);
  assert.equal(result.length, 101);
  assert.equal(result[100].messageID, "mid.100");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].message_limit, 100);
  assert.equal(calls[1].message_limit, 2);
});

test("post/comment reactions and friend-request decisions use validated FCA requests", async () => {
  const calls = [];
  const feedback = {
    viewer_feedback_reaction_info: { reaction: "LIKE" },
    supported_reactions: [{ reaction: "LIKE" }],
    top_reactions: { edges: [{ reaction: "LIKE", count: 1 }] },
    reaction_count: 1
  };
  const api = createFacebookThreadApi({ session, webClient: { post: async (url, body) => {
    calls.push({ url, body });
    if (url === "https://www.facebook.com/api/graphql/") {
      return { payload: { data: { feedback_react: { feedback } } } };
    }
    return { payload: { success: true } };
  } } });
  await api.setPostReaction("987654321", "like");
  await api.reactToPost("987654321", "love");
  await api.reactToComment("987654321", "haha");
  await api.handleFriendRequest("987654321", true);
  assert.equal(calls.length, 4);
  const first = JSON.parse(calls[0].body.variables);
  assert.equal(calls[0].body.doc_id, "4769042373179384");
  assert.equal(first.input.feedback_id, Buffer.from("feedback:987654321").toString("base64"));
  assert.equal(first.input.feedback_reaction, 1);
  assert.equal(JSON.parse(calls[1].body.variables).input.feedback_reaction, 16);
  assert.equal(JSON.parse(calls[2].body.variables).input.feedback_reaction, 4);
  assert.equal(calls[3].url, "https://www.facebook.com/requests/friends/ajax/");
  assert.equal(calls[3].body.action, "confirm");
  await assert.rejects(api.setPostReaction("987654321", "unknown"), /invalid reaction type/);
  assert.throws(() => api.handleFriendRequest("987654321", "yes"), /accept must be a boolean/);
});

