"use strict";

const { randomInt } = require("node:crypto");

const MESSENGER_MQTT_APP_ID = "2220391788200892";
const SEND_MESSAGE_VERSION_ID = "6120284488008082";

function offlineThreadingId(now = Date.now(), random = randomInt(1000, 10000)) {
  if (!Number.isSafeInteger(now) || now < 1 || !Number.isInteger(random) || random < 1000 || random > 9999) {
    throw new TypeError("Invalid offline threading ID inputs");
  }
  return (BigInt(now) * 1000n + BigInt(random)).toString();
}

/**
 * Builds the observed Messenger Lightspeed send-message task envelope.
 * This is a wire-shape helper only; broker acceptance must be verified live.
 */
function createMessengerSendMessageRequest(input = {}) {
  const threadID = String(input.threadID ?? "");
  if (!/^\d{5,30}$/.test(threadID)) throw new TypeError("threadID must be a numeric Facebook ID");
  const message = input.message;
  if (typeof message !== "string" && (!message || typeof message !== "object" || Array.isArray(message))) {
    throw new TypeError("message must be a string or message object");
  }
  const body = typeof message === "string" ? message : String(message.body ?? "");
  if (Buffer.byteLength(body, "utf8") > 20000) throw new RangeError("message body exceeds 20000 bytes");
  if (message && typeof message === "object" && (message.attachment || message.url)) {
    throw new TypeError("MQTT send helper currently supports text, sticker and reply only; use a verified upload flow for attachments");
  }
  const timestamp = input.timestamp ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 1) throw new TypeError("timestamp is invalid");
  const otid = input.otid ?? offlineThreadingId(timestamp);
  const epochId = input.epochId ?? offlineThreadingId(timestamp + 1);
  if (!/^\d{10,24}$/.test(String(otid)) || !/^\d{10,24}$/.test(String(epochId))) {
    throw new TypeError("otid and epochId must be numeric offline IDs");
  }
  const taskPayload = {
    thread_id: threadID, otid: String(otid), source: 0, send_type: message?.sticker ? 2 : 1,
    sync_group: 1, text: message?.sticker ? null : body, initiating_source: 1, skip_url_preview_gen: 0
  };
  if (message?.sticker) taskPayload.sticker_id = String(message.sticker);
  if (message?.emoji != null) {
    if (typeof message.emoji !== "string" || !message.emoji || message.emoji.length > 32) {
      throw new TypeError("emoji must be a non-empty string up to 32 characters");
    }
    const sizes = { small: 1, medium: 2, large: 3 };
    const rawSize = message.emojiSize ?? "small";
    const size = typeof rawSize === "number" ? rawSize : sizes[rawSize];
    if (!Number.isInteger(size) || size < 1 || size > 3) throw new TypeError("emojiSize must be 1, 2, 3, small, medium, or large");
    taskPayload.text = message.emoji;
    taskPayload.hot_emoji_size = size;
  }
  if (message?.location != null) {
    const location = message.location;
    if (!location || typeof location !== "object" || Array.isArray(location)) throw new TypeError("location must be an object");
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new TypeError("location latitude/longitude are out of range");
    }
    if (location.current !== undefined && typeof location.current !== "boolean") throw new TypeError("location.current must be a boolean");
    if (location.live !== undefined && typeof location.live !== "boolean") throw new TypeError("location.live must be a boolean");
    taskPayload.location_data = {
      coordinates: { latitude, longitude },
      is_current_location: Boolean(location.current),
      is_live_location: Boolean(location.live)
    };
  }
  if (input.replyToMessageID != null) {
    const replyTo = String(input.replyToMessageID);
    if (!replyTo || replyTo.length > 256) throw new TypeError("replyToMessageID is invalid");
    taskPayload.reply_metadata = { reply_source_id: replyTo, reply_source_type: 1, reply_type: 0 };
  }
  const tasks = [{
    label: "46", payload: JSON.stringify(taskPayload), queue_name: threadID,
    task_id: 0, failure_count: null
  }, {
    label: "21",
    payload: JSON.stringify({ thread_id: threadID, last_read_watermark_ts: timestamp, sync_group: 1 }),
    queue_name: threadID, task_id: 1, failure_count: null
  }];
  return Object.freeze({
    app_id: MESSENGER_MQTT_APP_ID,
    payload: JSON.stringify({ tasks, epoch_id: String(epochId), version_id: SEND_MESSAGE_VERSION_ID, data_trace_id: null }),
    request_id: input.requestId ?? null,
    type: 3
  });
}


const EDIT_MESSAGE_VERSION_ID = "6903494529735864";
const SHARE_CONTACT_VERSION_ID = "7214102258676893";

function createMessengerEditMessageRequest(input = {}) {
  const messageID = String(input.messageID ?? "");
  const text = String(input.text ?? "");
  if (!messageID || messageID.length > 256) throw new TypeError("messageID is invalid");
  if (!text || Buffer.byteLength(text, "utf8") > 20000) throw new TypeError("edit text must contain 1-20000 bytes");
  const epochId = input.epochId ?? Number.parseInt(offlineThreadingId(), 10);
  const taskId = input.taskId ?? randomInt(1, 10000);
  if (!Number.isSafeInteger(epochId) || epochId < 1) throw new TypeError("epochId is invalid");
  if (!Number.isInteger(taskId) || taskId < 1 || taskId > 65535) throw new TypeError("taskId is invalid");
  return Object.freeze({
    app_id: MESSENGER_MQTT_APP_ID,
    payload: JSON.stringify({
      data_trace_id: null,
      epoch_id: epochId,
      tasks: [{
        failure_count: null,
        label: "742",
        payload: JSON.stringify({ message_id: messageID, text }),
        queue_name: "edit_message",
        task_id: taskId
      }],
      version_id: EDIT_MESSAGE_VERSION_ID
    }),
    type: 3
  });
}

function createMessengerShareContactRequest(input = {}) {
  const senderID = String(input.senderID ?? "");
  const threadID = String(input.threadID ?? "");
  const text = String(input.text ?? "");
  if (!/^\d{5,30}$/.test(senderID)) throw new TypeError("senderID must be a numeric Facebook ID");
  if (!/^\d{5,30}$/.test(threadID)) throw new TypeError("threadID must be a numeric Facebook ID");
  if (Buffer.byteLength(text, "utf8") > 20000) throw new RangeError("contact text exceeds 20000 bytes");
  const epochId = input.epochId ?? offlineThreadingId();
  if (!/^\d{10,24}$/.test(String(epochId))) throw new TypeError("epochId is invalid");
  const taskId = input.taskId ?? randomInt(0, 1001);
  if (!Number.isInteger(taskId) || taskId < 0 || taskId > 1000) throw new TypeError("taskId is invalid");
  return Object.freeze({
    app_id: MESSENGER_MQTT_APP_ID,
    payload: JSON.stringify({
      tasks: [{
        label: "359",
        payload: JSON.stringify({ contact_id: senderID, sync_group: 1, text, thread_id: threadID }),
        queue_name: "messenger_contact_sharing",
        task_id: taskId,
        failure_count: null
      }],
      epoch_id: String(epochId),
      version_id: SHARE_CONTACT_VERSION_ID
    }),
    request_id: input.requestId ?? randomInt(1, 1000000),
    type: 3
  });
}


const CHANGE_GROUP_IMAGE_VERSION_ID = "8798795233522156";

function createMessengerChangeGroupImageRequest(input = {}) {
  const threadID = String(input.threadID ?? "");
  const imageID = String(input.imageID ?? "");
  if (!/^\d{5,30}$/.test(threadID)) throw new TypeError("threadID must be a numeric Facebook ID");
  if (!/^\d{5,30}$/.test(imageID)) throw new TypeError("imageID must be a numeric Facebook ID");
  const taskId = input.taskId ?? randomInt(1, 65536);
  if (!Number.isInteger(taskId) || taskId < 1 || taskId > 65535) throw new TypeError("taskId is invalid");
  const epochId = input.epochId ?? offlineThreadingId();
  if (!/^\d{10,24}$/.test(String(epochId))) throw new TypeError("epochId is invalid");
  return Object.freeze({
    app_id: MESSENGER_MQTT_APP_ID,
    payload: JSON.stringify({
      epoch_id: String(epochId),
      tasks: [{
        failure_count: null,
        label: "37",
        payload: JSON.stringify({ thread_key: threadID, image_id: imageID, sync_group: 1 }),
        queue_name: "thread_image",
        task_id: taskId
      }],
      version_id: CHANGE_GROUP_IMAGE_VERSION_ID
    }),
    type: 3
  });
}

module.exports = { MESSENGER_MQTT_APP_ID, SEND_MESSAGE_VERSION_ID, offlineThreadingId, createMessengerSendMessageRequest, createMessengerEditMessageRequest, createMessengerShareContactRequest, createMessengerChangeGroupImageRequest };
