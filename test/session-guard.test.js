"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSessionGuard } = require("../src/security/sessionGuard");

test("SessionGuard encrypts snapshots and preserves a verified backup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-guard-"));
  const filePath = path.join(directory, "private", "session.enc");
  const key = "a".repeat(64);
  let value = { userId: "123456789", appState: [{ key: "c_user", value: "123456789" }] };
  const guard = createSessionGuard({ filePath, key, getSession: () => value });
  try {
    await guard.saveNow();
    value = { ...value, savedAt: 2 };
    await guard.saveNow();
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.existsSync(filePath + ".bak"), true);
    assert.equal(guard.load().savedAt, 2);
    assert.doesNotThrow(() => guard.close());
    assert.throws(() => guard.load(), /closed/);
  } finally {
    guard.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionGuard recovers a corrupt primary from its encrypted backup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-recovery-"));
  const filePath = path.join(directory, "session.enc");
  const key = "b".repeat(64);
  let recovered;
  let savedAt = 1;
  const guard = createSessionGuard({
    filePath, key,
    getSession: () => ({ userId: "123456789", savedAt }),
    onRecovery: event => { recovered = event; }
  });
  try {
    await guard.saveNow();
    savedAt = 2;
    await guard.saveNow();
    fs.writeFileSync(filePath, "corrupt", "utf8");
    assert.equal(guard.load().savedAt, 1);
    assert.deepEqual(recovered, { source: "backup", restored: true });
  } finally {
    guard.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionGuard requires explicit paths, key validation and a safe interval", async () => {
  assert.throws(() => createSessionGuard({ getSession: () => ({}) }), /filePath is required/);
  const invalidKeyGuard = createSessionGuard({ filePath: "/tmp/a", key: "x", getSession: () => ({}) });
  await assert.rejects(invalidKeyGuard.saveNow(), /32 bytes|64 hexadecimal/);
  invalidKeyGuard.close();
  const guard = createSessionGuard({ filePath: "/tmp/omega-test-session.enc", key: "c".repeat(64), getSession: () => ({}) });
  try { assert.throws(() => guard.start(999), /at least 1000/); }
  finally { guard.close(); }
});
