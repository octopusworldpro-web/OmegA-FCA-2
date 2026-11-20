"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSessionGuard } = require("../src/security/sessionGuard");

test("session guard writes encrypted snapshots and preserves the previous verified snapshot", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-guard-"));
  const filePath = path.join(directory, "session.enc");
  const key = "d".repeat(64);
  let session = { userId: "100", cookies: [{ key: "xs", value: "first" }] };
  const guard = createSessionGuard({ filePath, key, getSession: () => session });
  try {
    await guard.saveNow();
    session = { userId: "100", cookies: [{ key: "xs", value: "second" }] };
    await guard.saveNow();
    assert.deepEqual(guard.load(), session);
    const paths = guard.getPaths();
    assert.deepEqual(require("../src/security/sessionStore").loadSession(paths.backupPath, key), {
      userId: "100", cookies: [{ key: "xs", value: "first" }]
    });
  } finally {
    guard.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("session guard restores a corrupted primary from its verified encrypted backup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-guard-"));
  const filePath = path.join(directory, "session.enc");
  const key = "e".repeat(64);
  const expected = { userId: "200", cookies: [{ key: "xs", value: "safe" }] };
  let recovered;
  const guard = createSessionGuard({
    filePath, key, getSession: () => expected,
    onRecovery: event => { recovered = event; }
  });
  try {
    await guard.saveNow();
    await guard.saveNow();
    fs.writeFileSync(filePath, "{corrupted");
    assert.deepEqual(guard.load(), expected);
    assert.deepEqual(recovered, { source: "backup", restored: true });
    assert.deepEqual(require("../src/security/sessionStore").loadSession(filePath, key), expected);
  } finally {
    guard.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("session guard rejects invalid paths, intervals and use after close", () => {
  assert.throws(() => createSessionGuard({ filePath: "", key: "a".repeat(64), getSession() {} }), /filePath/);
  assert.throws(() => createSessionGuard({ filePath: "/tmp/x", backupPath: "/tmp/x", key: "a".repeat(64), getSession() {} }), /different/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-guard-"));
  const guard = createSessionGuard({
    filePath: path.join(directory, "session.enc"),
    key: "f".repeat(64),
    getSession: () => ({ userId: "300" })
  });
  try {
    assert.throws(() => guard.start(999), /at least 1000/);
    guard.close();
    assert.throws(() => guard.load(), /closed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
