"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMessengerBot } = require("../src/compat/messengerBot");

test("MessengerBot dispatches commands, hears handlers and messageCreate events", async () => {
  let listener;
  let detached = 0;
  let loggedOut = 0;
  const sent = [];
  const api = {
    listenMqtt(callback) { listener = callback; return () => { detached++; }; },
    sendMessage(message, threadID) { sent.push({ message, threadID }); return Promise.resolve({ ok: true }); },
    logout: async () => { loggedOut++; }
  };
  const client = {
    login: async credentials => {
      assert.equal(credentials.mode, "appstate");
      assert.equal(credentials.appState.length, 1);
      return api;
    }
  };
  const bot = await createMessengerBot({ appState: [{ key: "c_user", value: "123456" }] }, {
    commandPrefix: "!",
    clientFactory: () => client
  });
  const events = [];
  bot.command("ping", async ctx => { await ctx.replyAsync("pong"); });
  bot.hears(/hello/i, async ctx => { await ctx.replyAsync("hi"); });
  bot.on("messageCreate", event => events.push(event.messageID));
  bot.launch();
  listener(null, { type: "message", body: "!ping", threadID: "987654321", senderID: "123456", messageID: "m1" });
  listener(null, { type: "message", body: "hello there", threadID: "987654321", senderID: "123456", messageID: "m2" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [
    { message: "pong", threadID: "987654321" },
    { message: "hi", threadID: "987654321" }
  ]);
  assert.deepEqual(events, ["m1", "m2"]);
  await bot.stop();
  assert.equal(detached, 1);
  assert.equal(loggedOut, 1);
});

test("MessengerBot validates credentials and command registration", async () => {
  await assert.rejects(createMessengerBot({}, { clientFactory: () => ({ login: async () => ({}) }) }), /AppState or encrypted session/);
  const api = { listenMqtt: () => () => {}, logout: async () => {} };
  const bot = await createMessengerBot({ appState: [] }, { clientFactory: () => ({ login: async () => api }) });
  assert.throws(() => bot.command("bad name", () => {}), /command name/);
  assert.throws(() => bot.hears(1, () => {}), /string or RegExp/);
});
