"use strict";

function finiteInt(value, name, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new TypeError(name + " must be an integer between " + min + " and " + max);
  }
  return number;
}

function normalizeOptions(input = {}, current = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("humanizer options must be an object");
  }
  const next = { ...current };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
    next.enabled = input.enabled;
  }
  if (input.reactDelayMs !== undefined) {
    if (Array.isArray(input.reactDelayMs)) {
      if (input.reactDelayMs.length !== 2) throw new TypeError("reactDelayMs array must contain [min, max]");
      const min = finiteInt(input.reactDelayMs[0], "reactDelayMs[0]", 0, 60000);
      const max = finiteInt(input.reactDelayMs[1], "reactDelayMs[1]", 0, 60000);
      if (max < min) throw new RangeError("reactDelayMs max must be greater than or equal to min");
      next.reactDelayMs = [min, max];
    } else {
      next.reactDelayMs = finiteInt(input.reactDelayMs, "reactDelayMs", 0, 60000);
    }
  }
  if (input.cooldownMs !== undefined) next.cooldownMs = finiteInt(input.cooldownMs, "cooldownMs", 0, 600000);
  if (input.maxPerMinute !== undefined) next.maxPerMinute = finiteInt(input.maxPerMinute, "maxPerMinute", 0, 1000);
  if (input.perThread !== undefined) {
    if (typeof input.perThread !== "boolean") throw new TypeError("perThread must be a boolean");
    next.perThread = input.perThread;
  }
  return next;
}

function createHumanizer(options = {}) {
  const sendTypingIndicator = typeof options.sendTypingIndicator === "function"
    ? options.sendTypingIndicator : () => Promise.resolve();
  const now = typeof options.now === "function" ? options.now : Date.now;
  const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const cancel = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  let config = normalizeOptions({
    enabled: true, reactDelayMs: 3000, cooldownMs: 5500, maxPerMinute: 20, perThread: true
  });
  const lastByScope = new Map();
  const recentStarts = [];
  const pending = new Map();
  let enabled = true;

  function getOptions() {
    return Object.freeze({
      ...config,
      reactDelayMs: Array.isArray(config.reactDelayMs) ? [...config.reactDelayMs] : config.reactDelayMs,
      enabled
    });
  }

  function setOptions(next) {
    config = normalizeOptions(next, config);
    if (next.enabled !== undefined) enabled = next.enabled;
    return getOptions();
  }

  function pickDelay() {
    if (!Array.isArray(config.reactDelayMs)) return config.reactDelayMs;
    const [min, max] = config.reactDelayMs;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function processEvent(event, callback) {
    if (typeof callback !== "function") throw new TypeError("humanizer callback is required");
    const threadID = event && event.threadID != null ? String(event.threadID) : "";
    if (!enabled || config.enabled === false || !threadID || !event || event.isE2EE) {
      callback(null, event);
      return;
    }

    const current = now();
    while (recentStarts.length && current - recentStarts[0] >= 60000) recentStarts.shift();
    if (config.maxPerMinute > 0 && recentStarts.length >= config.maxPerMinute) {
      callback(null, event);
      return;
    }

    const scope = config.perThread ? threadID : "*";
    const previous = lastByScope.get(scope) || 0;
    if (config.cooldownMs > 0 && current - previous < config.cooldownMs) {
      callback(null, event);
      return;
    }

    const delay = pickDelay();
    if (delay <= 0) {
      callback(null, event);
      return;
    }

    lastByScope.set(scope, current);
    recentStarts.push(current);
    try { Promise.resolve(sendTypingIndicator(threadID, true)).catch(() => {}); } catch {}

    const timer = schedule(() => {
      pending.delete(timer);
      try { Promise.resolve(sendTypingIndicator(threadID, false)).catch(() => {}); } catch {}
      callback(null, event);
    }, delay);
    pending.set(timer, threadID);
  }

  function stop() {
    for (const [timer, threadID] of pending) {
      cancel(timer);
      try { Promise.resolve(sendTypingIndicator(threadID, false)).catch(() => {}); } catch {}
    }
    pending.clear();
  }

  return {
    setOptions,
    getOptions,
    processEvent,
    stop,
    get enabled() { return enabled; },
    set enabled(value) {
      if (typeof value !== "boolean") throw new TypeError("enabled must be a boolean");
      enabled = value;
      config.enabled = value;
    }
  };
}

module.exports = { createHumanizer, normalizeOptions };
