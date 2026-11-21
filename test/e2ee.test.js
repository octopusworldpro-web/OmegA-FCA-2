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
const { E2EEClient } = require("../src/e2ee/client");
const proto = require("../src/e2ee/proto");

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


test("E2EE one-to-one reaction, edit and revoke encode the correct consumer payloads", async () => {
  const client = Object.create(E2EEClient.prototype);
  client.connect = () => Promise.resolve();
  const calls = [];
  client._sendMessageApp = (...args) => {
    calls.push(args);
    return Promise.resolve({ threadID: String(args[0]), messageID: "9000000000000000" });
  };
  const invoke = method => new Promise((resolve, reject) => {
    method.call(client, "123456789", "8000000000000000", ...(method === client.sendReaction
      ? ["👍", (error, result) => error ? reject(error) : resolve(result)]
      : method === client.editMessage
        ? ["corrected", (error, result) => error ? reject(error) : resolve(result)]
        : [(error, result) => error ? reject(error) : resolve(result)]));
  });
  await invoke(client.sendReaction);
  await invoke(client.editMessage);
  await invoke(client.unsendMessage);
  assert.equal(calls.length, 3);
  const reactionOuter = proto.decodeFields(calls[0][1]);
  const reactionPayload = proto.decodeFields(reactionOuter[1]);
  const reactionContent = proto.decodeFields(reactionPayload[1]);
  assert.equal(reactionContent[16] != null, true);
  assert.equal(calls[0][6], undefined);
  const editOuter = proto.decodeFields(calls[1][1]);
  const editPayload = proto.decodeFields(editOuter[1]);
  const editContent = proto.decodeFields(editPayload[1]);
  assert.equal(editContent[19] != null, true);
  assert.deepEqual(calls[1][6], { edit: "1" });
  const revokeOuter = proto.decodeFields(calls[2][1]);
  const revokePayload = proto.decodeFields(revokeOuter[1]);
  assert.equal(revokePayload[2] != null, true);
  assert.deepEqual(calls[2][6], { edit: "7" });
});

test("E2EE typing sends composing and paused chatstate frames", async () => {
  const client = Object.create(E2EEClient.prototype);
  client.connect = () => Promise.resolve();
  const frames = [];
  client.sendNode = node => { frames.push(node); return Promise.resolve(); };
  const invoke = isTyping => new Promise((resolve, reject) => {
    client.sendTyping("123456789", isTyping, (error, result) => error ? reject(error) : resolve(result));
  });
  await invoke(true);
  await invoke(false);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].tag, "chatstate");
  assert.equal(frames[0].attrs.type, "composing");
  assert.equal(frames[0].attrs.to, "123456789.0@msgr");
  assert.equal(frames[1].attrs.type, "paused");
});
