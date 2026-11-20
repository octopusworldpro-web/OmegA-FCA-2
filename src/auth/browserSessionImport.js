"use strict";

const { validateSessionCookies } = require("../security/cookies");
const { createSessionGuard } = require("../security/sessionGuard");

/**
 * Imports cookies from an already authenticated, owner-controlled Playwright
 * browser context and writes them directly to an encrypted SessionGuard file.
 * No password, 2FA secret, raw cookie text, or browser storage is returned.
 */
async function importBrowserSession({ context, filePath, key, backupPath } = {}) {
  if (!context || typeof context.cookies !== "function") {
    throw new TypeError("An authenticated Playwright browser context is required");
  }
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("An encrypted session filePath is required");
  }
  if (!(typeof key === "string" || Buffer.isBuffer(key) || key instanceof Uint8Array)) {
    throw new TypeError("An explicit owner-managed 32-byte/64-hex encryption key is required");
  }

  const raw = await context.cookies([
    "https://www.facebook.com/",
    "https://m.facebook.com/",
    "https://www.messenger.com/"
  ]);
  const cookies = validateSessionCookies(raw
    .filter(cookie => /(^|\\.)facebook\\.com$|(^|\\.)messenger\\.com$/i.test(cookie.domain || ""))
    .map(cookie => ({
      key: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || "/",
      hostOnly: !String(cookie.domain || "").startsWith("."),
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(Number.isFinite(cookie.expires) && cookie.expires > 0 ? { expires: Math.floor(cookie.expires) } : {})
    })));

  const userId = cookies.find(cookie => cookie.key === "c_user")?.value;
  const guard = createSessionGuard({
    filePath, backupPath, key,
    getSession: () => ({
      version: 1,
      userId,
      appState: cookies,
      savedAt: Date.now()
    })
  });
  try {
    await guard.saveNow();
    const verified = guard.load();
    if (String(verified.userId) !== String(userId) ||
        !Array.isArray(verified.appState) ||
        !verified.appState.some(cookie => cookie.key === "c_user" && cookie.value === userId) ||
        !verified.appState.some(cookie => cookie.key === "xs" && cookie.value)) {
      throw new Error("Encrypted browser session verification failed");
    }
    return Object.freeze({
      userId,
      cookieCount: verified.appState.length,
      filePath: guard.getPaths().filePath,
      backupPath: guard.getPaths().backupPath
    });
  } finally {
    guard.close();
  }
}

module.exports = { importBrowserSession };
