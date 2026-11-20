"use strict";

// Attach to a browser where the account owner has already signed in.
// Credentials and 2FA are entered only in Facebook's own browser UI.
const path = require("node:path");
const { importBrowserSession } = require("../src/auth/browserSessionImport");

function safeMessage(error) {
  return String(error && error.message || "Browser session import failed")
    .replace(/(c_user|xs|cookie|password|token|secret)(\s*[=:]\s*)[^\s,;]+/ig, "$1$2[REDACTED]");
}

async function main() {
  const cdp = process.env.OMEGA_CDP_URL || "http://127.0.0.1:9222";
  const key = process.env.FCA_SESSION_KEY;
  if (!key) throw new Error("Set FCA_SESSION_KEY in the local shell (64 hex characters or 32 raw bytes)");
  const filePath = path.resolve(process.env.FCA_SESSION_FILE || "./private/facebook-session.enc");

  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { throw new Error("Playwright is not installed; run npm install --no-save playwright"); }

  const browser = await chromium.connectOverCDP(cdp);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("No existing browser context was found");
    const result = await importBrowserSession({ context, filePath, key });
    process.stdout.write("Encrypted Facebook browser session saved.\n");
    process.stdout.write("Account ID: " + result.userId + "\n");
    process.stdout.write("Cookie count: " + result.cookieCount + "\n");
    process.stdout.write("Encrypted file: " + result.filePath + "\n");
    process.stdout.write("Encrypted backup: " + result.backupPath + "\n");
    process.stdout.write("No password, 2FA secret, or raw cookies were printed.\n");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write(safeMessage(error) + "\n");
  process.exitCode = 1;
});
