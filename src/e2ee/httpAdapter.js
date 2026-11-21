"use strict";

const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
const TRUSTED_HOST = /(^|\\.)(facebook\\.com|messenger\\.com|fbcdn\\.net|fbsbx\\.com)$/i;
const SESSION_HOST = /(^|\\.)(facebook\\.com|messenger\\.com)$/i;

function validateUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !TRUSTED_HOST.test(url.hostname)) {
    throw new TypeError("E2EE request URL is outside the trusted HTTPS Facebook media hosts");
  }
  return url;
}

async function readBounded(response, maxBytes) {
  const chunks = [];
  let total = 0;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new RangeError("E2EE response exceeds the configured byte limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  } else {
    const value = Buffer.from(await response.arrayBuffer());
    total = value.length;
    if (total > maxBytes) throw new RangeError("E2EE response exceeds the configured byte limit");
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function createE2EEHttpAdapter({ session, fetchImpl = globalThis.fetch, userAgent } = {}) {
  if (!session || typeof session.getCookieHeader !== "function") throw new TypeError("Active Facebook session is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  async function request(options = {}) {
    let url = validateUrl(options.url);
    let method = String(options.method || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) throw new TypeError("E2EE HTTP method must be GET or POST");
    const headers = new Headers(options.headers || {});
    if (headers.has("cookie") || headers.has("host") || headers.has("authorization")) {
      throw new TypeError("E2EE HTTP adapter manages credentials and Host headers");
    }
    if (userAgent && !headers.has("user-agent")) headers.set("user-agent", userAgent);
    let body = options.body;
    if (options.form && body !== undefined) throw new TypeError("Specify either form or body, not both");
    if (options.form) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.form)) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      body = form;
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded; charset=UTF-8");
    }
    const timeoutMs = Number.isFinite(options.timeout) ? Math.max(1000, Math.min(options.timeout, 240000)) : 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("E2EE HTTP request timed out")), timeoutMs);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const requestHeaders = new Headers(headers);
        if (SESSION_HOST.test(url.hostname)) {
          const cookie = session.getCookieHeader(url);
          if (cookie) requestHeaders.set("cookie", cookie);
        } else {
          requestHeaders.delete("cookie");
        }
        const response = await fetchImpl(url, {
          method, headers: requestHeaders, body: method === "GET" ? undefined : body,
          redirect: "manual", signal: controller.signal
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirects === 5) throw new Error("E2EE HTTP redirect limit or missing Location header");
          const next = validateUrl(new URL(location, url));
          if (next.origin !== url.origin) {
            headers.delete("authorization");
            if (!SESSION_HOST.test(next.hostname)) headers.delete("cookie");
          }
          if ([301, 302, 303].includes(response.status) && method === "POST") {
            method = "GET";
            body = undefined;
          }
          url = next;
          continue;
        }
        const buffer = await readBounded(response, Number.isInteger(options.maxResponseBytes) ? options.maxResponseBytes : MAX_RESPONSE_BYTES);
        return {
          statusCode: response.status,
          headers: response.headers,
          body: options.encoding === null ? buffer : buffer.toString("utf8")
        };
      }
      throw new Error("E2EE HTTP redirect limit exceeded");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ request });
}

module.exports = { createE2EEHttpAdapter, MAX_RESPONSE_BYTES };
