"use strict";

function callbackResult(operation, callback) {
  if (typeof callback !== "function") return operation;
  operation.then(value => callback(null, value), error => callback(error));
  return undefined;
}

function createBroadcastSender({ sendMessage } = {}) {
  if (typeof sendMessage !== "function") throw new TypeError("sendMessage is required");
  return function sendBroadcast(message, threadIDs, options, callback) {
    let settings = options;
    let done = callback;
    if (typeof settings === "function") { done = settings; settings = {}; }
    if (settings == null) settings = {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new TypeError("broadcast options must be an object");
    const targets = Array.isArray(threadIDs) ? threadIDs : [threadIDs];
    if (!targets.length || targets.length > 100) throw new RangeError("sendBroadcast requires 1 to 100 thread IDs");
    const normalized = targets.map(value => {
      const id = String(value ?? "");
      if (!/^\d{5,30}$/.test(id)) throw new TypeError("Every broadcast threadID must be a numeric Facebook ID");
      return id;
    });
    if (new Set(normalized).size !== normalized.length) throw new TypeError("Broadcast threadIDs must be unique");
    if (!(typeof message === "string" || (message && typeof message === "object" && !Array.isArray(message)))) {
      throw new TypeError("broadcast message must be a string or message object");
    }
    const delay = settings.delay === undefined ? 1000 : Number(settings.delay);
    const parallel = settings.parallel === undefined ? 1 : Number(settings.parallel);
    if (!Number.isInteger(delay) || delay < 0 || delay > 60000) throw new TypeError("broadcast delay must be an integer from 0 to 60000 ms");
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 5) throw new TypeError("broadcast parallel must be an integer from 1 to 5");
    if (settings.onEach !== undefined && typeof settings.onEach !== "function") throw new TypeError("onEach must be a function");
    const operation = (async () => {
      const results = new Array(normalized.length);
      for (let offset = 0; offset < normalized.length; offset += parallel) {
        const batch = normalized.slice(offset, offset + parallel);
        await Promise.all(batch.map(async (threadID, batchIndex) => {
          const index = offset + batchIndex;
          try {
            const result = await sendMessage(message, threadID);
            results[index] = { threadID, result, error: null };
            try { settings.onEach?.(null, result, threadID); } catch {}
          } catch (error) {
            results[index] = { threadID, result: null, error };
            try { settings.onEach?.(error, null, threadID); } catch {}
          }
        }));
        if (delay > 0 && offset + parallel < normalized.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      const sent = results.filter(item => item && !item.error).map(({ threadID, result }) => ({ threadID, result }));
      const failed = results.filter(item => item && item.error).map(({ threadID, error }) => ({ threadID, error }));
      return { total: normalized.length, sent, failed, results };
    })();
    return callbackResult(operation, done);
  };
}

module.exports = { createBroadcastSender };
