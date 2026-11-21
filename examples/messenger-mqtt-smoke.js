"use strict";

// Owner-operated live acceptance check. It reads account.txt/appstate.json
// locally, never prints cookies or message contents, and sends nothing unless
// the operator explicitly supplies --send plus both FCA_TEST_* variables.

const { createFacebookMqttClient, loadAccountConfig } = require("..");

async function main() {
  const account = loadAccountConfig();
  if (account.mode !== "appstate" || !Array.isArray(account.appState) || account.appState.length === 0) {
    throw new Error("A valid owner-controlled AppState is required in account.txt or appstate.json");
  }

  const client = createFacebookMqttClient({
    reconnect: { minDelayMs: 1_000, maxDelayMs: 15_000, factor: 2, jitter: 0.2, maxAttempts: 5 }
  });
  let api;
  let stopping = false;
  let ready = false;

  const shutdown = async signal => {
    if (stopping) return;
    stopping = true;
    if (signal) process.stdout.write("\n[OmegA-FCA] Closing Messenger session...\n");
    try { await client.logout(); }
    catch { process.stderr.write("[OmegA-FCA] Logout completed with a cleanup warning.\n"); }
  };

  process.once("SIGINT", () => { void shutdown("SIGINT").finally(() => { process.exitCode = 0; }); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM").finally(() => { process.exitCode = 0; }); });

  try {
    api = await client.login({ mode: "appstate", appState: account.appState });
    api.listenMqtt((error, event) => {
      if (error) {
        process.stderr.write("[OmegA-FCA] Listener error: " + (error.code || "FCA_LISTENER_ERROR") + "\n");
        return;
      }
      if (!event || typeof event !== "object") return;
      if (event.type === "ready") {
        ready = true;
        process.stdout.write("[OmegA-FCA] MQTT CONNACK and subscriptions are ready.\n");
        return;
      }
      const type = typeof event.type === "string" ? event.type.slice(0, 48) : "unknown";
      process.stdout.write("[OmegA-FCA] Event received: " + type + " (payload omitted)\n");
    });

    if (process.argv.includes("--send")) {
      const threadID = process.env.FCA_TEST_THREAD_ID;
      const message = process.env.FCA_TEST_MESSAGE;
      if (!threadID || !message) {
        throw new Error("--send requires FCA_TEST_THREAD_ID and FCA_TEST_MESSAGE to be set explicitly");
      }
      await api.sendMessage(message, threadID);
      process.stdout.write("[OmegA-FCA] Explicit test message request accepted by the client.\n");
    }

    if (!ready) {
      process.stdout.write("[OmegA-FCA] Login returned; waiting for MQTT ready/event output. Press Ctrl+C to stop.\n");
    } else {
      process.stdout.write("[OmegA-FCA] Live listener active. Press Ctrl+C to stop.\n");
    }
  } catch (error) {
    await shutdown();
    const code = error && typeof error.code === "string" ? error.code : "FCA_LIVE_SMOKE_FAILED";
    process.stderr.write("[OmegA-FCA] Live check failed: " + code + ". " + (error && error.message || "Check AppState and network.") + "\n");
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write("[OmegA-FCA] " + (error && error.message || "Live check failed") + "\n");
  process.exitCode = 1;
});
