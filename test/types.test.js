"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("package metadata points to the shipped public TypeScript declarations", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.types, "index.d.ts");
  assert.ok(fs.statSync(path.join(root, pkg.types)).isFile());
});

test("public declarations cover the exported client and Meta transport API", () => {
  const root = path.resolve(__dirname, "..");
  const declarations = fs.readFileSync(path.join(root, "index.d.ts"), "utf8");
  for (const symbol of [
    "createClient",
    "createGoatBotLogin",
    "ConnectionSupervisor",
    "EventDispatcher",
    "CookieJar",
    "createMetaMessengerTransport",
    "verifyWebhookSignature",
    "verifyWebhookChallenge",
    "verifyUpdateManifest"
  ]) {
    assert.match(declarations, new RegExp("\\b" + symbol + "\\b"), symbol + " declaration is missing");
  }
  assert.doesNotMatch(declarations, /reference types=["']node["']/);
});


test("every runtime root export has a public value declaration", () => {
  const root = path.resolve(__dirname, "..");
  const declarations = fs.readFileSync(path.join(root, "index.d.ts"), "utf8");
  const api = require(root);
  const declaredValues = new Set([...declarations.matchAll(/^export\s+(?:declare\s+)?(?:function|const|class|var|let|enum)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]));
  for (const name of Object.keys(api)) {
    assert.ok(declaredValues.has(name), `Missing TypeScript value declaration for runtime export: ${name}`);
  }
});
