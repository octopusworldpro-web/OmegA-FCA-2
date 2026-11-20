"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importBrowserSession } = require("../src/auth/browserSessionImport");
const { loadSession } = require("../src/security/sessionStore");

const browserCookies = [
  { name: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { name: "xs", value: "owner-session-cookie", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { name: "datr", value: "browser-cookie", domain: ".facebook.com", path: "/", secure: true },
  { name: "unrelated", value: "ignore-me", domain: ".example.com", path: "/" }
];

test("imports an owner-authenticated browser context directly into encrypted SessionGuard storage", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-browser-import-"));
  const filePath = path.join(directory, "facebook-session.enc");
  const key = "a".repeat(64);
  let requestedUrls;
  try {
    const result = await importBrowserSession({
      context: { async cookies(urls) { requestedUrls = urls; return browserCookies; } },
      filePath, key
    });
    assert.equal(result.userId, "123456789012345");
    assert.equal(result.cookieCount, 3);
    assert.equal(requestedUrls.length, 3);
    assert.equal(fs.existsSync(filePath), true);
    const saved = loadSession(filePath, key);
    assert.equal(saved.userId, "123456789012345");
    assert.equal(saved.appState.some(cookie => cookie.key === "xs"), true);
    assert.equal(saved.appState.some(cookie => cookie.key === "unrelated"), false);
    assert.equal(fs.readFileSync(filePath, "utf8").includes("owner-session-cookie"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects browser contexts without a valid authenticated Facebook session", async () => {
  await assert.rejects(importBrowserSession({
    context: { async cookies() { return [{ name: "datr", value: "only", domain: ".facebook.com" }]; } },
    filePath: "/tmp/not-written.enc", key: "b".repeat(64)
  }), /Facebook session requires valid c_user and xs cookies/);
});

test("requires explicit local encryption key", async () => {
  await assert.rejects(importBrowserSession({
    context: { async cookies() { return browserCookies; } },
    filePath: "/tmp/not-written.enc"
  }), /explicit owner-managed/);
});
