"use strict";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DELTAS = 500;
const MAX_DEPTH = 24;
const MAX_ATTACHMENTS = 100;
const MAX_TEXT_LENGTH = 100_000;

function parsePayload(input) {
  if (typeof input === "string" || Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (bytes.byteLength > MAX_JSON_BYTES) return null;
    try { return JSON.parse(bytes.toString("utf8")); } catch { return null; }
  }
  return input && typeof input === "object" ? input : null;
}

function withinDepth(value, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (!value || typeof value !== "object") return true;
  for (const child of Object.values(value)) if (!withinDepth(child, depth + 1)) return false;
  return true;
}

function firstString(...values) {
  return values.find(value => typeof value === "string" && value.length > 0) ?? null;
}

function firstId(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  }
  return null;
}

function firstObject(...values) {
  return values.find(value => value && typeof value === "object" && !Array.isArray(value)) ?? null;
}

function safeText(value, max = MAX_TEXT_LENGTH) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function normalizeAttachment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const image = firstObject(input.image, input.image_data, input.preview, input.thumbnail);
  const video = firstObject(input.video, input.video_data);
  const audio = firstObject(input.audio, input.audio_data);
  const file = firstObject(input.file, input.file_data);
  const url = firstString(input.url, input.href, input.uri, input.downloadUrl,
    input.download_url, image?.url, image?.uri, video?.url, audio?.url, file?.url);
  const id = firstId(input.id, input.ID, input.attachmentId, input.attachment_id,
    input.fbid, input.media_id, input.image_id);
  const mimeType = firstString(input.mimeType, input.mime_type, input.contentType, input.content_type);
  const filename = firstString(input.filename, input.fileName, input.name, input.title);
  const rawType = firstString(input.type, input.mimeType, input.mime_type, input.mediaType, input.media_type);
  let type = rawType || "unknown";
  if (/image|photo/i.test(type) || image) type = "photo";
  else if (/video/i.test(type) || video) type = "video";
  else if (/audio|sound/i.test(type) || audio) type = "audio";
  else if (/file|document/i.test(type) || file || filename) type = "file";
  else if (/sticker/i.test(type) || input.sticker_id != null) type = "sticker";
  const result = { ...input, type };
  if (url) result.url = url;
  if (id) { result.ID = id; result.id = id; }
  if (filename) result.filename = filename;
  if (mimeType) result.mimeType = mimeType;
  return result;
}

function normalizeAttachments(...sources) {
  for (const source of sources) {
    if (Array.isArray(source)) return source.slice(0, MAX_ATTACHMENTS).map(normalizeAttachment).filter(Boolean);
  }
  return [];
}

function normalizeQuotedMessage(delta, metadata, replyTo) {
  const quoted = firstObject(delta.messageReply, delta.replyMessage, delta.repliedToMessage,
    delta.reply_to_message, metadata.messageReply, metadata.replyMessage, metadata.replySourceMessage);
  if (!quoted && !replyTo) return null;
  const quotedMetadata = quoted?.messageMetadata && typeof quoted.messageMetadata === "object"
    ? quoted.messageMetadata : {};
  const quotedID = firstId(quoted?.messageID, quoted?.messageId, quoted?.id,
    quotedMetadata.messageId, replyTo);
  const quotedSender = firstId(quoted?.senderID, quoted?.senderId, quoted?.actorId, quoted?.actorFbId,
    quotedMetadata.actorFbId, quotedMetadata.senderId);
  const attachments = normalizeAttachments(quoted?.attachments, quoted?.attachment,
    quoted?.blob_attachments, quoted?.platform_xmd);
  const result = {
    messageID: quotedID,
    senderID: quotedSender,
    body: safeText(quoted?.body ?? quoted?.text),
    attachments,
    timestamp: quoted?.timestamp ?? quotedMetadata.timestamp ?? null,
    threadID: firstId(quoted?.threadID, quoted?.threadId,
      quotedMetadata.threadKey?.threadFbId, quotedMetadata.threadKey?.otherUserFbId)
  };
  if (quoted?.sticker) result.sticker = quoted.sticker;
  return result;
}

const LOG_EVENT_TYPES = Object.freeze({
  ThreadName: "log:thread-name",
  ThreadColor: "log:thread-color",
  ThreadIcon: "log:thread-icon",
  ThreadEmoji: "log:thread-icon",
  ParticipantAdded: "log:subscribe",
  ParticipantsAdded: "log:subscribe",
  ParticipantRemoved: "log:unsubscribe",
  ParticipantsRemoved: "log:unsubscribe",
  ThreadAdmin: "log:thread-admins",
  ThreadAdmins: "log:thread-admins",
  ApprovalMode: "log:thread-approval-mode",
  ThreadApprovalMode: "log:thread-approval-mode",
  ThreadCall: "log:thread-call",
  ThreadPoll: "log:thread-poll",
  ThreadEvent: "log:thread-event"
});

function normalizeDelta(delta) {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return null;
  const kind = firstString(delta.class, delta.type, delta.deltaType);
  if (!kind) return null;
  const metadata = delta.messageMetadata && typeof delta.messageMetadata === "object"
    ? delta.messageMetadata : {};
  const threadKey = metadata.threadKey || delta.threadKey || {};
  const threadID = firstId(threadKey.threadFbId, threadKey.otherUserFbId,
    metadata.thread_id, delta.threadID, delta.threadId);
  const messageID = firstId(metadata.messageId, metadata.message_id, delta.messageId, delta.message_id);
  const senderID = firstId(metadata.actorFbId, metadata.senderId, delta.senderId, delta.actorId,
    delta.from, delta.userId);
  const timestamp = metadata.timestamp ?? metadata.timestampMs ?? delta.timestamp ?? delta.timestampMs;
  const base = {
    threadID, messageID, senderID, timestamp: timestamp ?? null,
    rawDelta: delta
  };

  switch (kind) {
    case "NewMessage":
    case "Message": {
      const replyTo = firstId(metadata.replySourceMessageId, metadata.replyToMessageId,
        delta.replyToMessageId, delta.reply_to_message_id, delta.replySourceMessageId);
      const attachments = normalizeAttachments(delta.attachments, delta.blob_attachments,
        delta.platform_xmd, metadata.attachments);
      const messageReply = normalizeQuotedMessage(delta, metadata, replyTo);
      const event = {
        ...base,
        type: replyTo || messageReply ? "message_reply" : "message",
        userID: senderID,
        author: senderID,
        body: safeText(delta.body ?? delta.text ?? delta.message),
        attachments,
        isGroup: Boolean(threadKey.threadFbId),
        isUnread: delta.isUnread !== false,
        mentions: firstObject(delta.mentions, metadata.mentions) || {},
        messageReply
      };
      if (!messageReply) delete event.messageReply;
      const sticker = firstString(delta.sticker_id, delta.stickerId, delta.sticker);
      if (sticker) event.sticker = sticker;
      const replyId = messageReply?.messageID || replyTo;
      if (replyId) event.replyToMessageID = replyId;
      return event;
    }
    case "MessageReaction":
    case "Reaction":
      return {
        ...base, type: "message_reaction",
        author: senderID,
        reaction: firstString(delta.reaction, delta.reactionEmoji, delta.reactionString, delta.reaction_emoji),
        userID: senderID,
        messageID: messageID || firstId(delta.messageId, delta.targetMessageId)
      };
    case "MessageUnsend":
    case "UnsendMessage":
      return { ...base, type: "message_unsend" };
    case "Typing":
    case "TypingNotification":
      return { ...base, type: "typ", isTyping: delta.isTyping !== false && delta.typing !== false };
    case "ReadReceipt":
    case "MarkRead":
    case "ReadReceiptEvent": {
      const reader = firstId(delta.reader, delta.readerId, delta.actorFbId, senderID);
      return {
        ...base, type: "read_receipt", reader,
        userID: reader,
        watermarkTimestamp: delta.watermarkTimestamp ?? delta.watermark_timestamp ??
          metadata.watermarkTimestamp ?? metadata.watermark_timestamp ?? timestamp,
        threadID: threadID || firstId(delta.threadFbId, delta.thread_id),
        messageID: messageID || firstId(delta.messageId, delta.lastReadMessageId)
      };
    }
    case "Presence":
    case "PresenceUpdate":
      return { ...base, type: "presence", status: delta.status ?? delta.presence ?? null };
    default: {
      const logType = LOG_EVENT_TYPES[kind];
      if (logType) {
        const logData = delta.eventData ?? delta.logMessageData ?? delta;
        const actor = firstId(delta.actorFbId, delta.actorId, senderID);
        return {
          ...base, type: "event", logMessageType: logType,
          logMessageData: logData,
          author: actor, userID: actor,
          participantIDs: Array.isArray(delta.participantIds)
            ? delta.participantIds.map(value => firstId(value)).filter(Boolean) : undefined
        };
      }
      if (/^(Thread|Participant|Approval|Admin|Poll|Call)/.test(kind)) {
        return { ...base, type: "event", logMessageType: "log:thread-event", logMessageData: delta };
      }
      return { ...base, type: "unknown_delta", deltaType: kind };
    }
  }
}

function extractDeltas(envelope) {
  if (!envelope || typeof envelope !== "object" || !withinDepth(envelope)) return [];
  const candidates = [
    envelope.deltas, envelope.payload?.deltas, envelope.data?.deltas,
    envelope.sync_payload?.deltas, envelope.syncPayload?.deltas
  ];
  const deltas = candidates.find(Array.isArray);
  return deltas ? deltas.slice(0, MAX_DELTAS) : [];
}

function parseMessengerSyncPayload(input) {
  const envelope = parsePayload(input);
  if (!envelope || typeof envelope !== "object" || !withinDepth(envelope)) {
    return { events: [], envelope: null, cursor: null };
  }
  const deltas = extractDeltas(envelope);
  const events = deltas.map(normalizeDelta).filter(Boolean);
  const cursor = {
    syncToken: firstString(envelope.syncToken, envelope.sync_token,
      envelope.payload?.syncToken, envelope.payload?.sync_token),
    lastSeqId: envelope.lastIssuedSeqId ?? envelope.last_seq_id ??
      envelope.lastSeqId ?? envelope.firstDeltaSeqId ?? envelope.seq ?? null
  };
  if (cursor.syncToken === null && cursor.lastSeqId === null) return { events, envelope, cursor: null };
  return { events, envelope, cursor };
}

module.exports = {
  parseMessengerSyncPayload, normalizeMessengerDelta: normalizeDelta,
  normalizeMessengerAttachment: normalizeAttachment,
  MAX_JSON_BYTES, MAX_DELTAS, MAX_ATTACHMENTS
};
