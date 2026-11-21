"use strict";

const { randomInt } = require("node:crypto");
const { offlineThreadingId } = require("./messengerActions");
const { createFacebookWebClient } = require("../auth/facebookWebClient");
const { createFacebookError } = require("../auth/facebookResponse");

const GRAPHQL_BATCH = "https://www.facebook.com/api/graphqlbatch/";
const USER_INFO_URL = "https://www.facebook.com/chat/user_info/";
const SEND_URL = "https://www.facebook.com/messaging/send/";
const REMOVE_URL = "https://www.facebook.com/chat/remove_participants";
const NICKNAME_URL = "https://www.facebook.com/messaging/save_thread_nickname/?source=thread_settings&dpr=1";
const REACTION_URL = "https://www.facebook.com/webgraphql/mutation/";
const READ_URL = "https://www.facebook.com/ajax/mercury/change_read_status.php";
const UNSEND_URL = "https://www.facebook.com/messaging/unsend_message/";
const TITLE_URL = "https://www.facebook.com/messaging/set_thread_name/";
const COLOR_URL = "https://www.facebook.com/messaging/save_thread_color/?source=thread_settings&dpr=1";
const EMOJI_URL = "https://www.facebook.com/messaging/save_thread_emoji/?source=thread_settings&dpr=1";
const TYPING_URL = "https://www.facebook.com/ajax/messaging/typ.php";
const TYPEAHEAD_URL = "https://www.facebook.com/ajax/typeahead/search.php";
const PHOTO_URL = "https://www.facebook.com/mercury/attachments/photo";
const FRIENDS_URL = "https://www.facebook.com/chat/user_info_all";
const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";
const DELIVERY_URL = "https://www.facebook.com/ajax/mercury/delivery_receipts.php";
const READ_ALL_URL = "https://www.facebook.com/ajax/mercury/mark_folder_as_read.php";
const SEEN_URL = "https://www.facebook.com/ajax/mercury/mark_seen.php";
const DELETE_MESSAGE_URL = "https://www.facebook.com/ajax/mercury/delete_messages.php";
const DELETE_THREAD_URL = "https://www.facebook.com/ajax/mercury/delete_thread.php";
const MUTE_THREAD_URL = "https://www.facebook.com/ajax/mercury/change_mute_thread.php";
const ARCHIVE_THREAD_URL = "https://www.facebook.com/ajax/mercury/change_archived_status.php";

// Public FCA document IDs. Facebook changes private web query IDs without notice.
const DOC_IDS = Object.freeze({
  threadList: "1349387578499440",
  threadInfo: "1498317363570230",
  threadHistory: "1498317363570230",
  reaction: "1491398900900362"
});

function id(value, label) {
  const result = String(value ?? "");
  if (!/^\d{5,30}$/.test(result)) throw new TypeError(label + " must be a numeric Facebook ID");
  return result;
}
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function first(...values) { return values.find(value => value !== undefined && value !== null) ?? null; }
function graphResult(payload, operation) {
  if (!Array.isArray(payload) || !payload.length) {
    throw createFacebookError(operation + ": Facebook returned an unexpected GraphQL batch response", {
      code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false
    });
  }
  const status = object(payload[payload.length - 1]);
  if (Number(status.error_results || 0) > 0 || status.error) {
    const detail = object(payload[0]).o0?.errors?.[0];
    throw createFacebookError(operation + ": Facebook rejected the GraphQL request" +
      (detail?.message ? ": " + String(detail.message).slice(0, 180) : ""), {
      code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
    });
  }
  if (Number(status.successful_results ?? 1) === 0) {
    throw createFacebookError(operation + ": Facebook reported no successful GraphQL result", {
      code: "FCA_RESPONSE_EMPTY", retryable: true
    });
  }
  return object(payload[0]).o0;
}
function threadKey(thread) {
  const key = object(thread?.thread_key);
  return first(key.thread_fbid, key.other_user_id, thread?.threadID, thread?.thread_id);
}
function participants(thread) {
  const nodes = object(thread?.all_participants).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map(item => {
    const actor = object(item?.messaging_actor);
    return {
      userID: actor.id == null ? null : String(actor.id),
      name: actor.name ?? null,
      profilePicture: actor.big_image_src?.uri ?? null,
      url: actor.url ?? null,
      username: actor.username ?? null,
      accountType: actor.__typename ?? null
    };
  }).filter(item => item.userID);
}
function formatThread(thread) {
  const customization = object(thread?.customization_info);
  const last = thread?.last_message?.nodes?.[0] || null;
  const people = participants(thread);
  const idValue = threadKey(thread);
  return {
    threadID: idValue == null ? null : String(idValue),
    name: thread?.name || (people.find(person => person.userID === String(thread?.thread_key?.other_user_id))?.name ?? null),
    unreadCount: Number(thread?.unread_count || 0),
    messageCount: Number(thread?.messages_count || 0),
    imageSrc: thread?.image?.uri ?? null,
    emoji: customization.emoji ?? null,
    color: customization.outgoing_bubble_color ? String(customization.outgoing_bubble_color).replace(/^FF/i, "") : null,
    nicknames: (customization.participant_customizations || []).map(item => ({
      userID: String(item.participant_id), nickname: item.nickname ?? null
    })),
    muteUntil: thread?.mute_until ?? null,
    participants: people,
    participantIDs: people.map(person => person.userID),
    adminIDs: (thread?.thread_admins || []).map(item => String(item.id ?? item)),
    folder: thread?.folder ?? null,
    isGroup: thread?.thread_type === "GROUP",
    isArchived: Boolean(thread?.has_viewer_archived),
    isSubscribed: Boolean(thread?.is_viewer_subscribed),
    timestamp: first(thread?.updated_time_precise, null),
    snippet: last?.snippet ?? null,
    snippetAttachments: last?.extensible_attachment ?? null,
    snippetSender: last?.message_sender?.messaging_actor?.id == null ? null : String(last.message_sender.messaging_actor.id),
    lastMessageTimestamp: last?.timestamp_precise ?? null,
    lastReadTimestamp: thread?.last_read_receipt?.nodes?.[0]?.timestamp_precise ?? null,
    cannotReplyReason: thread?.cannot_reply_reason ?? null,
    threadType: thread?.thread_type === "GROUP" ? 2 : 1
  };
}
function formatMessage(message, threadID, isGroup) {
  const senderID = first(message?.message_sender?.id, message?.message_sender?.messaging_actor?.id);
  const messageID = first(message?.message_id, message?.messageID);
  const body = message?.message?.text ?? message?.snippet ?? "";
  const attachments = Array.isArray(message?.blob_attachments) ? message.blob_attachments : [];
  const mentions = {};
  for (const range of message?.message?.ranges || []) {
    if (range?.entity?.id != null) mentions[String(range.entity.id)] = body.substr(range.offset || 0, range.length || 0);
  }
  return {
    type: "message", threadID: String(threadID), messageID: messageID == null ? null : String(messageID),
    senderID: senderID == null ? null : String(senderID), timestamp: first(message?.timestamp_precise, null),
    body, attachments, mentions, isGroup: Boolean(isGroup), isUnread: Boolean(message?.unread),
    messageReactions: Array.isArray(message?.message_reactions) ? message.message_reactions : []
  };
}
function callbackResult(operation, callback) {
  if (typeof callback !== "function") return operation;
  operation.then(value => callback(null, value), error => callback(error));
  return undefined;
}
function unwrapGraph(response, operation) {
  const result = graphResult(response.payload, operation);
  return result?.data ?? result;
}

function createFacebookThreadApi({ session, webClient, clientId = "omega-fca" } = {}) {
  if (!session || typeof session.request !== "function") throw new TypeError("An active personal session is required");
  const web = webClient || createFacebookWebClient({ session });
  const currentUserID = id(session.userId, "session.userId");

  async function graph(queryParams, docId, operation) {
    const payload = await web.post(GRAPHQL_BATCH, {
      av: currentUserID,
      queries: JSON.stringify({ o0: { doc_id: docId, query_params: queryParams } })
    });
    return unwrapGraph(payload, operation);
  }

  function httpPost(url, form, callback) {
    if (typeof form === "function") { callback = form; form = {}; }
    if (!form || typeof form !== "object" || Array.isArray(form)) {
      throw new TypeError("httpPost form must be an object");
    }
    const operation = web.post(url, form).then(result => {
      if (typeof result.raw !== "string") {
        throw createFacebookError("httpPost: response body was not available", {
          code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false
        });
      }
      return result.raw;
    });
    return callbackResult(operation, callback);
  }

  function httpGet(url, query, callback) {
    if (typeof query === "function") { callback = query; query = {}; }
    if (query == null) query = {};
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw new TypeError("httpGet query must be an object");
    }
    const operation = web.get(url, { query }).then(result => {
      if (typeof result.raw !== "string") {
        throw createFacebookError("httpGet: response body was not available", {
          code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false
        });
      }
      return result.raw;
    });
    return callbackResult(operation, callback);
  }

  function getThreadList(limit, timestamp = null, tags = [], callback) {
    if (typeof tags === "function") { callback = tags; tags = []; }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("getThreadList limit must be an integer from 1 to 100");
    if (timestamp !== null && (!Number.isSafeInteger(timestamp) || timestamp < 0)) throw new TypeError("getThreadList timestamp must be an integer or null");
    if (typeof tags === "string") tags = [tags];
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || tag.length > 32)) throw new TypeError("getThreadList tags must be an array of strings");
    const operation = (async () => {
      const data = await graph({
        limit: limit + (timestamp ? 1 : 0), before: timestamp, tags,
        includeDeliveryReceipts: true, includeSeqID: false
      }, DOC_IDS.threadList, "getThreadList");
      const nodes = data?.viewer?.message_threads?.nodes;
      if (!Array.isArray(nodes)) throw createFacebookError("getThreadList: response is missing message_threads.nodes", { code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false });
      if (timestamp) nodes.shift();
      return nodes.map(formatThread);
    })();
    return callbackResult(operation, callback);
  }

  function getThreadInfo(threadID, callback) {
    const thread = id(threadID, "threadID");
    const operation = (async () => {
      const data = await graph({
        id: thread, message_limit: 0, load_messages: 0, load_read_receipts: false, before: null
      }, DOC_IDS.threadInfo, "getThreadInfo");
      const raw = data?.message_thread;
      if (!raw) throw createFacebookError("getThreadInfo: response is missing message_thread", { code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false });
      return formatThread(raw);
    })();
    return callbackResult(operation, callback);
  }

  function getThreadHistory(threadID, amount, timestamp, callback) {
    if (typeof timestamp === "function") { callback = timestamp; timestamp = undefined; }
    const thread = id(threadID, "threadID");
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new TypeError("getThreadHistory amount must be an integer from 1 to 100");
    if (timestamp !== undefined && timestamp !== null && (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0)) {
      throw new TypeError("getThreadHistory timestamp must be an integer, null, or undefined");
    }
    const operation = (async () => {
      const data = await graph({
        id: thread, message_limit: amount, load_messages: 1, load_read_receipts: false,
        before: timestamp == null ? null : Number(timestamp)
      }, DOC_IDS.threadHistory, "getThreadHistory");
      const raw = data?.message_thread;
      const nodes = raw?.messages?.nodes;
      if (!Array.isArray(nodes)) throw createFacebookError("getThreadHistory: response is missing messages.nodes", { code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false });
      const isGroup = raw.thread_type === "GROUP";
      return nodes.map(message => formatMessage(message, thread, isGroup)).filter(message => message.messageID);
    })();
    return callbackResult(operation, callback);
  }

  function getMessage(threadID, messageID, callback) {
    const thread = id(threadID, "threadID");
    if (typeof messageID !== "string" || !messageID.trim() || messageID.length > 256) {
      throw new TypeError("messageID is invalid");
    }
    const target = messageID.trim();
    const operation = getThreadHistory(thread, 100, null).then(messages =>
      messages.find(message => message.messageID === target) ?? null
    );
    return callbackResult(operation, callback);
  }

  function getUserID(name, callback) {
    if (typeof name !== "string" || !name.trim() || name.length > 256) throw new TypeError("name is invalid");
    const value = name.trim().toLowerCase();
    const operation = web.get(TYPEAHEAD_URL, {
      query: { value, viewer: session.userId, rsp: "search", context: "search", path: "/home.php", request_id: clientId }
    }).then(result => {
      const payload = object(result?.payload);
      if (payload.error) throw createFacebookError("getUserID: Facebook rejected the search", { code: "FCA_FACEBOOK_REQUEST_REJECTED" });
      const entries = Array.isArray(payload.payload?.entries) ? payload.payload.entries :
        (Array.isArray(payload.entries) ? payload.entries : []);
      return entries.map(entry => ({
        userID: id(entry.uid, "userID"),
        photoUrl: entry.photo || null,
        indexRank: entry.index_rank ?? null,
        name: entry.text || null,
        isVerified: Boolean(entry.is_verified),
        profileUrl: entry.path || null,
        category: entry.category || null,
        score: entry.score ?? null,
        type: entry.type || null
      }));
    });
    return callbackResult(operation, callback);
  }

  function getUID(input, callback) {
    const raw = String(input ?? "").trim();
    if (!raw || raw.length > 2048) throw new TypeError("profile input is invalid");
    if (/^\d{5,30}$/.test(raw)) return callbackResult(Promise.resolve(raw), callback);
    let username = raw;
    const lowerRaw = raw.toLowerCase();
    if (lowerRaw.startsWith("http://") || lowerRaw.startsWith("https://") || lowerRaw.includes("facebook.com")) {
      let parsed;
      try {
        const candidate = lowerRaw.startsWith("http://") || lowerRaw.startsWith("https://") ? raw : "https://" + raw;
        parsed = new URL(candidate);
      } catch { throw new TypeError("profile URL is invalid"); }
      if (!(parsed.hostname.toLowerCase() === "facebook.com" || parsed.hostname.toLowerCase().endsWith(".facebook.com"))) {
        throw new TypeError("profile URL must belong to facebook.com");
      }
      if (parsed.pathname.toLowerCase() === "/profile.php") {
        const direct = parsed.searchParams.get("id");
        if (direct && /^\d{5,30}$/.test(direct)) return callbackResult(Promise.resolve(direct), callback);
      }
      const parts = parsed.pathname.split("/").filter(Boolean);
      const last = parts.at(-1) || "";
      if (/^\d{5,30}$/.test(last)) return callbackResult(Promise.resolve(last), callback);
      username = parts[0] === "people" ? (parts[1] || "") : (parts[0] || "");
    }
    if (!username || username.includes("/") || username.length > 128) throw new TypeError("profile username is invalid");
    const operation = getUserID(username).then(entries => {
      const first = entries[0]?.userID;
      if (!first) {
        const error = new Error("Facebook profile could not be resolved");
        error.code = "FCA_USER_NOT_FOUND";
        throw error;
      }
      return first;
    });
    return callbackResult(operation, callback);
  }

  function resolvePhotoUrl(photoID, callback) {
    const photo = String(photoID ?? "").trim();
    if (!photo || photo.length > 256) throw new TypeError("photoID is invalid");
    const operation = web.get(PHOTO_URL, { query: { photo_id: photo } }).then(result => {
      if (result?.payload?.error) throw createFacebookError("resolvePhotoUrl: Facebook rejected the photo lookup", { code: "FCA_FACEBOOK_REQUEST_REJECTED" });
      const value = result?.payload?.jsmods?.require?.[0]?.[3]?.[0];
      if (!value) return "";
      let parsed;
      try { parsed = new URL(String(value)); } catch { throw new Error("Facebook returned an invalid photo URL"); }
      if (parsed.protocol !== "https:" || !/(^|\.)(?:fbcdn\.net|facebook\.com|fbsbx\.com)$/i.test(parsed.hostname)) {
        throw new Error("Facebook returned a photo URL outside the approved CDN hosts");
      }
      return parsed.toString();
    });
    return callbackResult(operation, callback);
  }

  function getFriendsList(callback) {
    const operation = web.post(FRIENDS_URL, {}, { query: { viewer: session.userId } }).then(result => {
      const payload = object(result?.payload?.payload ?? result?.payload);
      if (payload.error) throw createFacebookError("getFriendsList: Facebook rejected the friend-list request", { code: "FCA_FACEBOOK_REQUEST_REJECTED" });
      const values = Array.isArray(payload) ? payload : Object.values(payload);
      const genders = ["unknown", "female_singular", "male_singular", "female_singular_guess", "male_singular_guess", "mixed", "neuter_singular", "unknown_singular", "female_plural", "male_plural", "neuter_plural", "unknown_plural"];
      return values.filter(user => user && typeof user === "object").map(user => ({
        alternateName: user.alternateName || null,
        firstName: user.firstName || null,
        gender: genders[Number(user.gender)] || "unknown",
        userID: user.id == null ? "" : String(user.id),
        isFriend: Boolean(user.is_friend),
        fullName: user.name || null,
        profilePicture: user.thumbSrc || null,
        type: user.type || null,
        profileUrl: user.uri || null,
        vanity: user.vanity || null,
        isBirthday: Boolean(user.is_birthday)
      }));
    });
    return callbackResult(operation, callback);
  }

  function createNewGroup(participantIDs, groupTitle, callback) {
    let title = groupTitle;
    let done = callback;
    if (typeof title === "function") { done = title; title = null; }
    if (!Array.isArray(participantIDs) || participantIDs.length < 2 || participantIDs.length > 250) {
      throw new TypeError("participantIDs must contain 2-250 Facebook IDs");
    }
    const participants = participantIDs.map(value => ({ fbid: id(value, "participantID") }));
    if (!participants.some(value => value.fbid === session.userId)) participants.push({ fbid: session.userId });
    if (title != null && (typeof title !== "string" || title.length > 100)) throw new TypeError("groupTitle must be a string up to 100 characters");
    const form = {
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "MessengerGroupCreateMutation",
      av: session.userId,
      doc_id: "577041672419534",
      variables: JSON.stringify({
        input: {
          entry_point: "jewel_new_group",
          actor_id: session.userId,
          participants,
          client_mutation_id: String(randomInt(1, 1025)),
          thread_settings: {
            name: typeof title === "string" ? title : null,
            joinable_mode: "PRIVATE",
            thread_image_fbid: null
          }
        }
      })
    };
    const operation = web.post(GRAPHQL_URL, form).then(result => {
      const payload = object(result?.payload);
      if (payload.errors?.length) throw createFacebookError("createNewGroup: Facebook rejected the group creation", { code: "FCA_FACEBOOK_REQUEST_REJECTED" });
      const threadID = payload.data?.messenger_group_thread_create?.thread?.thread_key?.thread_fbid;
      if (!threadID) throw new Error("Facebook returned an invalid createNewGroup response");
      return String(threadID);
    });
    return callbackResult(operation, done);
  }

  function getUserInfo(ids, callback) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!list.length || list.length > 100) throw new TypeError("getUserInfo requires 1 to 100 user IDs");
    const normalized = list.map(value => id(value, "userID"));
    const body = Object.fromEntries(normalized.map((value, index) => ["ids[" + index + "]", value]));
    const operation = (async () => {
      const response = await web.post(USER_INFO_URL, body);
      const profiles = response.payload?.payload?.profiles;
      if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
        throw createFacebookError("getUserInfo: response is missing payload.profiles", { code: "FCA_RESPONSE_SHAPE_INVALID", retryable: false });
      }
      return Object.fromEntries(Object.entries(profiles).map(([userID, profile]) => [userID, {
        name: profile?.name ?? null, firstName: profile?.firstName ?? null, vanity: profile?.vanity ?? null,
        thumbSrc: profile?.thumbSrc ?? null, profileUrl: profile?.uri ?? null, gender: profile?.gender ?? null,
        type: profile?.type ?? null, isFriend: Boolean(profile?.is_friend), isBirthday: Boolean(profile?.is_birthday)
      }]));
    })();
    return callbackResult(operation, callback);
  }

  function addUserToGroup(userIDs, threadID, callback) {
    const thread = id(threadID, "threadID");
    const users = (Array.isArray(userIDs) ? userIDs : [userIDs]).map(value => id(value, "userID"));
    if (!users.length || users.length > 50) throw new TypeError("addUserToGroup requires 1 to 50 user IDs");
    const stamp = Date.now();
    const body = {
      client: "mercury", action_type: "ma-type:log-message", author: "fbid:" + currentUserID,
      timestamp: stamp, timestamp_absolute: "Today", timestamp_relative: "0", timestamp_time_passed: "0",
      is_unread: false, is_cleared: false, is_forward: false, source: "source:chat:web",
      "source_tags[0]": "source:chat", log_message_type: "log:subscribe", status: "0",
      offline_threading_id: String(stamp * 1000), message_id: String(stamp * 1000),
      manual_retry_cnt: "0", thread_fbid: thread
    };
    users.forEach((user, index) => { body["log_message_data[added_participants][" + index + "]"] = "fbid:" + user; });
    const operation = web.post(SEND_URL, body).then(result => {
      if (!result.payload || result.payload.error) throw createFacebookError("addUserToGroup: Facebook rejected the group update", { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function removeUserFromGroup(userID, threadID, callback) {
    const body = { uid: id(userID, "userID"), tid: id(threadID, "threadID") };
    const operation = web.post(REMOVE_URL, body).then(result => {
      if (!result.payload || result.payload.error) throw createFacebookError("removeUserFromGroup: Facebook rejected the group update", { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function changeNickname(nickname, threadID, participantID, callback) {
    if (typeof nickname !== "string" || nickname.length > 80) throw new TypeError("nickname must be a string up to 80 characters");
    const body = { nickname, participant_id: id(participantID, "participantID"), thread_or_other_fbid: id(threadID, "threadID") };
    const operation = web.post(NICKNAME_URL, body).then(result => {
      if (!result.payload || result.payload.error) throw createFacebookError("changeNickname: Facebook rejected the nickname update", { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function setMessageReaction(reaction, messageID, callback) {
    if (typeof reaction !== "string" || reaction.length > 16) throw new TypeError("reaction must be an emoji, shortcut, or empty string");
    if (typeof messageID !== "string" || !messageID || messageID.length > 256) throw new TypeError("messageID is invalid");
    const aliases = { ":heart_eyes:": "😍", ":love:": "😍", ":laughing:": "😆", ":haha:": "😆",
      ":open_mouth:": "😮", ":wow:": "😮", ":cry:": "😢", ":sad:": "😢", ":angry:": "😠",
      ":thumbsup:": "👍", ":like:": "👍", ":thumbsdown:": "👎", ":dislike:": "👎" };
    const value = aliases[reaction] ?? reaction;
    const body = { doc_id: DOC_IDS.reaction, variables: JSON.stringify({ data: {
      client_mutation_id: 1, actor_id: currentUserID,
      action: value === "" ? "REMOVE_REACTION" : "ADD_REACTION", message_id: messageID, reaction: value
    } }), dpr: 1 };
    const operation = web.post(REACTION_URL, body).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("setMessageReaction: Facebook rejected the reaction update", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function setTitle(newTitle, threadID, callback) {
    if (typeof newTitle !== "string" || newTitle.length > 100) throw new TypeError("newTitle must be a string up to 100 characters");
    const thread = id(threadID, "threadID");
    const timestamp = Date.now();
    const offlineId = offlineThreadingId(timestamp);
    const threadingId = "<" + timestamp + ":" + randomInt(0, 0xffffffff) + "-" + String(clientId) + "@mail.projektitan.com>";
    const body = {
      client: "mercury", action_type: "ma-type:log-message",
      author: "fbid:" + currentUserID, author_email: "", coordinates: "",
      timestamp, timestamp_absolute: "Today", timestamp_relative: "0",
      timestamp_time_passed: "0", is_unread: false, is_cleared: false,
      is_forward: false, is_filtered_content: false, is_spoof_warning: false,
      source: "source:chat:web", "source_tags[0]": "source:chat", status: "0",
      offline_threading_id: offlineId, message_id: offlineId,
      threading_id: threadingId, manual_retry_cnt: "0",
      thread_fbid: thread, thread_name: newTitle, thread_id: thread,
      log_message_type: "log:thread-name"
    };
    const operation = web.post(TITLE_URL, body).then(result => {
      const error = result.payload?.error;
      if (error) {
        const message = error === 1545012 ? "Cannot change chat title: not a member of the chat"
          : error === 1545003 ? "Cannot set title of a one-to-one chat"
          : "Facebook rejected the thread title update";
        throw createFacebookError("setTitle: " + message, { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      }
      return { threadID: thread };
    });
    return callbackResult(operation, callback);
  }

  function changeThreadColor(color, threadID, callback) {
    if (typeof color !== "string" || color.length > 64) throw new TypeError("color must be a theme ID, hex color, or empty string");
    const thread = id(threadID, "threadID");
    const normalized = color === "196241301102133" || color.toLowerCase() === "#0084ff" ? "" : color;
    const operation = web.post(COLOR_URL, { color_choice: normalized, thread_or_other_fbid: thread }).then(result => {
      if (!result.payload || result.payload.error) {
        throw createFacebookError("changeThreadColor: Facebook rejected the color update", { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function changeThreadEmoji(emoji, threadID, callback) {
    if (typeof emoji !== "string" || emoji.length > 16) throw new TypeError("emoji must be a string up to 16 characters");
    const thread = id(threadID, "threadID");
    const operation = web.post(EMOJI_URL, { emoji_choice: emoji, thread_or_other_fbid: thread }).then(result => {
      if (!result.payload || result.payload.error) {
        throw createFacebookError("changeThreadEmoji: Facebook rejected the emoji update", { code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function sendTypingIndicator(first, second, third, fourth) {
    let threadID;
    let typing;
    let callback;
    let isGroup;
    let returnStopHandle = false;
    // Support both the native ergonomic signature (threadID, boolean, cb)
    // and legacy FCA's (typ, threadID, cb, isGroup) call convention.
    if ((first === 0 || first === 1 || typeof first === "boolean") &&
        (typeof second === "string" || typeof second === "number")) {
      typing = Boolean(first);
      threadID = second;
      callback = third;
      isGroup = fourth;
    } else {
      threadID = first;
      if (typeof second === "function") {
        typing = true;
        callback = second;
        returnStopHandle = true;
      } else {
        typing = second === undefined ? true : second;
        callback = third;
        returnStopHandle = second === undefined;
      }
    }
    if (typeof typing !== "boolean") throw new TypeError("typing must be a boolean or legacy 0/1 value");
    const thread = id(threadID, "threadID");
    const body = { typ: typing ? 1 : 0, to: "", source: "mercury-chat", thread };
    const operation = (async () => {
      if (typeof isGroup === "boolean") {
        if (!isGroup) body.to = thread;
      } else {
        const profiles = await getUserInfo(thread);
        if (Object.keys(profiles || {}).length > 0) body.to = thread;
      }
      const result = await web.post(TYPING_URL, body);
      if (!result.payload || result.payload.error) {
        throw createFacebookError("sendTypingIndicator: Facebook rejected the typing update", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      if (!returnStopHandle || !typing) return result.payload;
      let stopPromise = null;
      return function endTyping(endCallback) {
        if (!stopPromise) {
          stopPromise = web.post(TYPING_URL, { ...body, typ: 0 }).then(stopResult => {
            if (!stopResult.payload || stopResult.payload.error) {
              throw createFacebookError("sendTypingIndicator: Facebook rejected the typing stop request", {
                code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
              });
            }
            return stopResult.payload;
          });
        }
        return callbackResult(stopPromise, endCallback);
      };
    })();
    return callbackResult(operation, callback);
  }

  function unsendMessage(messageID, callback) {
    if (typeof messageID !== "string" || !messageID || messageID.length > 256) {
      throw new TypeError("messageID is invalid");
    }
    const operation = web.post(UNSEND_URL, { message_id: messageID }).then(result => {
      if (!result.payload || result.payload.error) {
        throw createFacebookError("unsendMessage: Facebook rejected the unsend request", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function markAsDelivered(threadID, messageID, callback) {
    const thread = id(threadID, "threadID");
    if (typeof messageID !== "string" || !messageID.trim() || messageID.length > 256 || messageID.split("").some(character => character.charCodeAt(0) < 32)) throw new TypeError("messageID is invalid");
    const message = messageID.trim();
    const body = {
      "message_ids[0]": message,
      ["thread_ids[" + thread + "][0]"]: message
    };
    const operation = web.post(DELIVERY_URL, body).then(result => {
      if (!result.payload || result.payload.error) {
        throw createFacebookError("markAsDelivered: Facebook rejected the delivery receipt", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function markAsReadAll(callback) {
    const operation = web.post(READ_ALL_URL, { folder: "inbox" }).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("markAsReadAll: Facebook rejected the read-all request", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function markAsSeen(timestamp, callback) {
    let seenTimestamp = timestamp;
    let done = callback;
    if (typeof seenTimestamp === "function") { done = seenTimestamp; seenTimestamp = Date.now(); }
    if (seenTimestamp === undefined || seenTimestamp === null) seenTimestamp = Date.now();
    const parsed = Number(seenTimestamp);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("seen timestamp must be a non-negative integer");
    const operation = web.post(SEEN_URL, { seen_timestamp: parsed }).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("markAsSeen: Facebook rejected the seen receipt", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, done);
  }

  function deleteMessage(messageID, callback) {
    const message = String(messageID ?? "").trim();
    if (!message || message.length > 256 || /[\\u0000-\\u001f]/.test(message)) {
      throw new TypeError("messageID is invalid");
    }
    const operation = web.post(DELETE_MESSAGE_URL, { "message_ids[0]": message }).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("deleteMessage: Facebook rejected the delete request", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function deleteThread(threadIDs, callback) {
    const values = Array.isArray(threadIDs) ? threadIDs : [threadIDs];
    if (!values.length || values.length > 100) throw new RangeError("deleteThread requires 1 to 100 thread IDs");
    const normalized = values.map(value => id(value, "threadID"));
    const form = { client: "mercury" };
    normalized.forEach((value, index) => { form["ids[" + index + "]"] = value; });
    const operation = web.post(DELETE_THREAD_URL, form).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("deleteThread: Facebook rejected the delete request", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function muteThread(threadID, muteSeconds, callback) {
    const thread = id(threadID, "threadID");
    const duration = Number(muteSeconds);
    if (!Number.isInteger(duration) || duration < -1 || duration > 31_536_000) {
      throw new TypeError("muteSeconds must be -1 (permanent), 0 (unmute), or an integer up to one year");
    }
    const operation = web.post(MUTE_THREAD_URL, {
      thread_fbid: thread, mute_settings: duration
    }).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("muteThread: Facebook rejected the mute update", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function changeArchivedStatus(threadIDs, archive, callback) {
    if (typeof archive !== "boolean") throw new TypeError("archive must be a boolean");
    const values = Array.isArray(threadIDs) ? threadIDs : [threadIDs];
    if (!values.length || values.length > 100) throw new RangeError("changeArchivedStatus requires 1 to 100 thread IDs");
    const normalized = values.map(value => id(value, "threadID"));
    const form = {};
    normalized.forEach(value => { form["ids[" + value + "]"] = archive; });
    const operation = web.post(ARCHIVE_THREAD_URL, form).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("changeArchivedStatus: Facebook rejected the archive update", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  function markAsRead(threadID, read = true, callback) {
    if (typeof read === "function") { callback = read; read = true; }
    if (typeof read !== "boolean") throw new TypeError("read must be a boolean");
    const thread = id(threadID, "threadID");
    const body = { ["ids[" + thread + "]"]: read, watermarkTimestamp: Date.now(),
      shouldSendReadReceipt: true, commerce_last_message_type: "non_ad" };
    const operation = web.post(READ_URL, body).then(result => {
      if (!result?.payload || result.payload.error || result.payload.errors?.length) {
        throw createFacebookError("markAsRead: Facebook rejected the read receipt", {
          code: "FCA_FACEBOOK_REQUEST_REJECTED", retryable: false
        });
      }
      return result.payload;
    });
    return callbackResult(operation, callback);
  }

  return Object.freeze({ httpGet, httpPost, getThreadList, getThreadInfo, getThreadHistory, getMessage, getUserID, getUID, resolvePhotoUrl, getFriendsList, createNewGroup, getUserInfo,
    addUserToGroup, removeUserFromGroup, changeNickname, changeThreadColor, changeThreadEmoji, setTitle, setMessageReaction, markAsRead, markAsReadAll, markAsSeen, markAsDelivered, deleteMessage, deleteThread, muteThread, changeArchivedStatus, unsendMessage, sendTypingIndicator });
}

module.exports = { createFacebookThreadApi, DOC_IDS };
