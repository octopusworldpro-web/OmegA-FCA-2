"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { saveSession, loadSession } = require("./sessionStore");

const DEFAULT_BACKUP_SUFFIX = ".bak";

function createSessionGuard({ filePath, key, getSession, backupPath, onRecovery } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");
  if (typeof getSession !== "function") throw new TypeError("getSession function is required");
  const target = path.resolve(filePath);
  const backup = path.resolve(backupPath || target + DEFAULT_BACKUP_SUFFIX);
  if (target === backup) throw new TypeError("Session and backup paths must be different");
  let closed = false;
  let timer = null;
  let saving = null;

  function assertOpen() {
    if (closed) throw new Error("Session guard is closed");
  }

  async function saveNow() {
    assertOpen();
    if (saving) return saving;
    saving = Promise.resolve().then(async () => {
      const session = await getSession();
      if (!session || typeof session !== "object" || Array.isArray(session)) {
        throw new TypeError("getSession must return a session object");
      }
      try {
        const previous = loadSession(target, key);
        saveSession(backup, previous, key);
      } catch (error) {
        if (error.code !== "ENOENT") {
          try { loadSession(backup, key); }
          catch (backupError) {
            if (backupError.code !== "ENOENT") throw backupError;
          }
        }
      }
      saveSession(target, session, key);
      return target;
    }).finally(() => { saving = null; });
    return saving;
  }

  function load() {
    assertOpen();
    try {
      return loadSession(target, key);
    } catch (primaryError) {
      let restored;
      try { restored = loadSession(backup, key); }
      catch { throw primaryError; }
      saveSession(target, restored, key);
      if (typeof onRecovery === "function") {
        try { onRecovery(Object.freeze({ source: "backup", restored: true })); } catch {}
      }
      return restored;
    }
  }

  function start(intervalMs = 60_000) {
    assertOpen();
    if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
      throw new RangeError("intervalMs must be an integer of at least 1000");
    }
    if (timer) return stop;
    timer = setInterval(() => {
      void saveNow().catch(error => {
        if (typeof onRecovery === "function") {
          try { onRecovery(Object.freeze({ source: "save", restored: false, errorCode: error.code || "FCA_SESSION_GUARD_SAVE_FAILED" })); } catch {}
        }
      });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return stop;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function close() {
    if (closed) return;
    stop();
    closed = true;
  }

  return Object.freeze({ saveNow, load, start, stop, close, getPaths: () => Object.freeze({ filePath: target, backupPath: backup }) });
}

module.exports = { createSessionGuard };
