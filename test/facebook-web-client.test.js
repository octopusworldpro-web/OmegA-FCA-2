"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFacebookWebClient, assertFacebookUrl, toFormBody } = require("../src/auth/facebookWebClient");

function fakeResponse({ status = 200, body = "{\"ok\":true}", contentType = "application/json", location = null } = {}) {
  return {
    status,
    headers: { get(name) {
      const key = name.toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return String(Buffer.byteLength(body));
      if (key === "location") return location;
      return null;
    } },
    async text() { return body; }
  };
}

test("builds authenticated POST form with available session tokens", async () => {
  let request;
  const session = {
    userId: "123456789",
    getTokens: () => ({ fbDtsg: "dtsg", lsd: "lsd", jazoest: "22000", hsi: null, spinR: null, spinB: null, spinT: null }),
    getCookieHeader: () => "c_user=123456789",
    request: async (url, options) => { request = { url, options }; return fakeResponse(); }
  };
  const client = createFacebookWebClient({ session });
  const result = await client.post("https://www.facebook.com/api/test/", { value: "hello", nested: { a: 1 } });
  assert.equal(result.payload.ok, true);
  assert.equal(request.options.method, "POST");
  assert.match(request.options.headers.get("content-type"), /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("value"), "hello");
  assert.equal(form.get("nested"), "{\"a\":1}");
  assert.equal(form.get("av"), "123456789");
  assert.equal(form.get("fb_dtsg"), "dtsg");
  assert.equal(form.get("lsd"), "lsd");
  assert.equal(form.get("jazoest"), "22000");
});

test("supports GET query params and normalizes Facebook error responses", async () => {
  let request;
  const session = {
    userId: "123456789", getTokens: () => ({}), getCookieHeader: () => "",
    request: async (url, options) => {
      request = { url, options };
      return fakeResponse({ body: "{\"error\":{\"message\":\"checkpoint_required\"}}" });
    }
  };
  const client = createFacebookWebClient({ session });
  await assert.rejects(client.get("https://www.facebook.com/api/test/", { query: { limit: 5 } }),
    error => error.code === "FCA_CHECKPOINT_REQUIRED");
  assert.equal(request.url.searchParams.get("limit"), "5");
  assert.equal(request.options.method, "GET");
});

test("rejects non-Facebook hosts, unsafe methods and invalid form keys", async () => {
  assert.throws(() => assertFacebookUrl("https://example.com/"), /Facebook\/Messenger/);
  assert.throws(() => assertFacebookUrl("http://www.facebook.com/"), /Facebook\/Messenger/);
  assert.throws(() => toFormBody({ "bad field": "x" }, {}, "1"), /field name is invalid/);
  const client = createFacebookWebClient({
    session: { userId: "1", getTokens: () => ({}), getCookieHeader: () => "", request: async () => fakeResponse() }
  });
  await assert.rejects(client.request("https://www.facebook.com/", { method: "DELETE" }), /GET, HEAD, and POST/);
});

test("does not follow Facebook redirects and classifies login/checkpoint states", async () => {
  const makeClient = location => createFacebookWebClient({
    session: {
      userId: "1", getTokens: () => ({}), getCookieHeader: () => "",
      request: async () => fakeResponse({ status: 302, location, body: "" })
    }
  });
  await assert.rejects(makeClient("https://www.facebook.com/checkpoint/").get("https://www.facebook.com/"),
    error => error.code === "FCA_CHECKPOINT_REQUIRED" && error.retryable === false);
  await assert.rejects(makeClient("https://www.facebook.com/login.php").get("https://www.facebook.com/"),
    error => error.code === "FCA_SESSION_EXPIRED" && error.sessionState === "logged_out");
  await assert.rejects(makeClient("https://www.facebook.com/somewhere").get("https://www.facebook.com/"),
    error => error.code === "FCA_UNEXPECTED_REDIRECT");
});

test("rejects oversized outbound action bodies before making a request", async () => {
  let calls = 0;
  const client = createFacebookWebClient({
    session: { userId: "1", getTokens: () => ({}), getCookieHeader: () => "",
      request: async () => { calls++; return fakeResponse(); } }
  });
  await assert.rejects(client.post("https://www.facebook.com/api/test/", "x".repeat(2 * 1024 * 1024 + 1)),
    error => error.code === "FCA_REQUEST_TOO_LARGE");
  assert.equal(calls, 0);
});


test("posts bounded multipart forms with session tokens without overriding the boundary header", async () => {
  let request;
  const session = {
    userId: "123456789",
    getTokens: () => ({ fbDtsg: "dtsg", lsd: "lsd", jazoest: "22000" }),
    getCookieHeader: () => "c_user=123456789",
    request: async (url, options) => { request = { url, options }; return fakeResponse(); }
  };
  const client = createFacebookWebClient({ session });
  const form = new FormData();
  form.append("images_only", "true");
  form.append("attachment[]", new Blob([Buffer.from([1, 2, 3])], { type: "image/png" }), "image.png");
  const result = await client.postMultipart("https://www.facebook.com/ajax/mercury/upload.php", form);
  assert.equal(result.payload.ok, true);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, form);
  assert.equal(request.options.headers.has("content-type"), false);
  assert.equal(form.get("av"), "123456789");
  assert.equal(form.get("fb_dtsg"), "dtsg");
  assert.equal(form.get("lsd"), "lsd");
  assert.equal(form.get("jazoest"), "22000");
  assert.equal(form.get("attachment[]").name, "image.png");
});

test("rejects oversized multipart bodies before making a request", async () => {
  let calls = 0;
  const client = createFacebookWebClient({
    session: { userId: "1", getTokens: () => ({}), getCookieHeader: () => "",
      request: async () => { calls++; return fakeResponse(); } }
  });
  const form = new FormData();
  form.append("file", new Blob([Buffer.alloc(12 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
  await assert.rejects(client.postMultipart("https://www.facebook.com/upload/", form),
    error => error.code === "FCA_REQUEST_TOO_LARGE");
  assert.equal(calls, 0);
});
