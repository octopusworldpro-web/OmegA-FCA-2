"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("../src/e2ee/crypto");
const media = require("../src/e2ee/media");
const { DeviceStore } = require("../src/e2ee/store");
const { createE2EEHttpAdapter } = require("../src/e2ee/httpAdapter");

test("E2EE X25519 key agreement and XEdDSA signed-prekey verification", () => {
  const alice = crypto.generateKeyPair();
  const bob = crypto.generateKeyPair();
  const ab = crypto.dh(alice.priv, bob.pub);
  const ba = crypto.dh(bob.priv, alice.pub);
  assert.deepEqual(ab, ba);
  const message = Buffer.from("omega-fca-e2ee-signed-prekey");
  const signature = crypto.xeddsaSign(alice.priv, message);
  assert.equal(crypto.xeddsaVerify(alice.pub, message, signature), true);
  assert.equal(crypto.xeddsaVerify(alice.pub, Buffer.from("tampered"), signature), false);
});

test("E2EE media encryption round-trips and rejects altered ciphertext", () => {
  const source = Buffer.from("private encrypted messenger attachment\0\x01\x02");
  for (const kind of ["image", "video", "audio", "document"]) {
    const encrypted = media.encryptMedia(source, kind);
    assert.notDeepEqual(encrypted.ciphertext, source);
    assert.deepEqual(media.decryptMedia(encrypted.ciphertext, encrypted.mediaKey, kind), source);
    const altered = Buffer.from(encrypted.ciphertext);
    altered[0] ^= 1;
    assert.throws(() => media.decryptMedia(altered, encrypted.mediaKey, kind), /HMAC mismatch/);
  }
});

test("E2EE device store persists only AES-256-GCM ciphertext with mode 0600", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-e2ee-"));
  const filePath = path.join(directory, "device.json");
  const key = Buffer.alloc(32, 0x5a);
  try {
    const store = DeviceStore.fromFile(filePath, key);
    const identity = Buffer.from(store.identityKeyPair.pub);
    store.generatePreKeys(3);
    store.save();
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(envelope.format, "omega-fca-e2ee-store");
    assert.equal(envelope.algorithm, "aes-256-gcm");
    assert.equal(Object.hasOwn(envelope, "identity_key_priv"), false);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    const restored = DeviceStore.fromFile(filePath, key);
    assert.deepEqual(restored.identityKeyPair.pub, identity);
    assert.equal(Object.keys(restored.preKeys).length, 3);
    assert.throws(() => DeviceStore.fromFile(filePath, Buffer.alloc(32, 0x11)), error =>
      error.code === "FCA_E2EE_STORE_DECRYPT_FAILED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("persistent E2EE storage refuses to write private keys without an explicit key", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-e2ee-no-key-"));
  const filePath = path.join(directory, "device.json");
  try {
    assert.throws(() => DeviceStore.fromFile(filePath), error =>
      error.code === "FCA_E2EE_STORAGE_KEY_REQUIRED");
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("E2EE HTTP adapter sends session cookies only to Facebook hosts", async () => {
  const calls = [];
  const session = {
    getCookieHeader(url) {
      const host = new URL(url).hostname;
      if (!/(^|\.)facebook\.com$/i.test(host)) throw new TypeError("cookie host denied");
      return "c_user=123; xs=secret";
    }
  };
  const adapter = createE2EEHttpAdapter({
    session,
    fetchImpl: async (url, options) => {
      calls.push({ host: new URL(url).hostname, cookie: options.headers.get("cookie") || null });
      return new Response('{"direct_path":"/encrypted/blob"}', { status: 200 });
    }
  });
  await adapter.request({ method: "POST", url: "https://reg-e2ee.facebook.com/v2/fb_icdc_fetch", form: { fbid: "123" } });
  await adapter.request({ method: "GET", url: "https://scontent.xx.fbcdn.net/encrypted/blob" });
  assert.equal(calls[0].cookie, "c_user=123; xs=secret");
  assert.equal(calls[1].cookie, null);
  await assert.rejects(adapter.request({ method: "GET", url: "https://evil.example/file" }), /trusted HTTPS/);
});
