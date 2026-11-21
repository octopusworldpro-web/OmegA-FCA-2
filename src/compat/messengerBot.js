"use strict";

const { EventEmitter } = require("node:events");
const { createFacebookMqttClient } = require("./facebookMqttClient");

function normalizeCredentials(credentials) {
  if (Array.isArray(credentials)) return { mode: "appstate", appState: credentials };
  if (credentials && typeof credentials === "object" && Array.isArray(credentials.appState)) {
    return { mode: "appstate", appState: credentials.appState };
  }
  if (credentials && typeof credentials === "object" && credentials.mode === "session") {
    return { mode: "session" };
  }
  if (credentials && typeof credentials === "object" && credentials.mode === "appstate" && Array.isArray(credentials.appState)) {
    return credentials;
  }
  throw new TypeError("createMessengerBot requires an owner-supplied AppState or encrypted session credentials");
}

class MessengerBot extends EventEmitter {
  constructor(client, api, options = {}) {
    super();
    this.client = client;
    this.api = api;
    this.commandPrefix = typeof options.commandPrefix === "string" ? options.commandPrefix : "/";
    this.commands = new Map();
    this.hearHandlers = [];
    this.detach = null;
    this.started = false;
    this.stopOnSignals = options.stopOnSignals === true;
    this._signalHandlers = null;
  }

  command(names, handler) {
    if (typeof handler !== "function") throw new TypeError("command handler must be a function");
    const list = Array.isArray(names) ? names : [names];
    if (!list.length) throw new TypeError("at least one command name is required");
    for (const raw of list) {
      const name = String(raw || "").trim().replace(/^\/+/, "").toLowerCase();
      if (!/^[a-z0-9_-]{1,64}$/.test(name)) throw new TypeError("command name is invalid");
      this.commands.set(name, handler);
    }
    return this;
  }

  hears(pattern, handler) {
    if (!(typeof pattern === "string" || pattern instanceof RegExp)) throw new TypeError("hears pattern must be a string or RegExp");
    if (typeof handler !== "function") throw new TypeError("hears handler must be a function");
    this.hearHandlers.push({ pattern, handler });
    return this;
  }

  _context(event, args = [], match = null) {
    const threadID = event.threadID;
    const replyAsync = (message, callback) => this.api.sendMessage(message, threadID, callback);
    return Object.freeze({
      event, api: this.api, threadID, senderID: event.senderID,
      body: String(event.body || ""), message: String(event.body || ""),
      args: Object.freeze([...args]), match,
      replyAsync, reply: replyAsync,
      send: (message, callback) => this.api.sendMessage(message, threadID, callback)
    });
  }

  async _dispatch(error, event) {
    if (error) {
      this.emit("botError", error);
      return;
    }
    if (!event || typeof event !== "object") return;
    this.emit("event", event);
    if (event.type !== "message" && event.type !== "message_reply") return;
    const body = typeof event.body === "string" ? event.body : "";
    const context = this._context(event);
    this.emit("messageCreate", event, context);

    if (this.commandPrefix && body.startsWith(this.commandPrefix)) {
      const commandLine = body.slice(this.commandPrefix.length).trim();
      const [name, ...args] = commandLine.split(/\s+/).filter(Boolean);
      const handler = name ? this.commands.get(name.toLowerCase()) : null;
      if (handler) {
        try { await handler(this._context(event, args)); }
        catch (caught) { this.emit("botError", caught); }
      }
    }

    for (const entry of this.hearHandlers) {
      let match = null;
      if (entry.pattern instanceof RegExp) {
        entry.pattern.lastIndex = 0;
        match = entry.pattern.exec(body);
      } else if (body.toLowerCase().includes(entry.pattern.toLowerCase())) {
        match = body;
      }
      if (match) {
        try { await entry.handler(this._context(event, [], match)); }
        catch (caught) { this.emit("botError", caught); }
      }
    }
  }

  launch(options = {}) {
    if (this.started) return this;
    if (!this.api || typeof this.api.listenMqtt !== "function") throw new Error("MessengerBot requires an FCA API with listenMqtt()");
    this.started = true;
    const stopOnSignals = options.stopOnSignals === undefined ? this.stopOnSignals : options.stopOnSignals === true;
    this.detach = this.api.listenMqtt((error, event) => { void this._dispatch(error, event); }) || null;
    if (stopOnSignals && typeof process !== "undefined" && typeof process.once === "function") {
      const stop = () => { void this.stop(); };
      this._signalHandlers = { SIGINT: stop, SIGTERM: stop };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }
    this.emit("ready", this.api);
    return this;
  }

  async stop() {
    if (typeof this.detach === "function") {
      try { this.detach(); } catch (error) { this.emit("botError", error); }
    }
    this.detach = null;
    this.started = false;
    if (this._signalHandlers && typeof process !== "undefined") {
      process.removeListener("SIGINT", this._signalHandlers.SIGINT);
      process.removeListener("SIGTERM", this._signalHandlers.SIGTERM);
      this._signalHandlers = null;
    }
    if (this.api && typeof this.api.logout === "function") await this.api.logout();
    else if (this.client && typeof this.client.logout === "function") await this.client.logout();
    this.emit("stop");
  }
}

async function createMessengerBot(credentials, options = {}) {
  const factory = typeof options.clientFactory === "function"
    ? options.clientFactory
    : createFacebookMqttClient;
  const clientOptions = options.clientOptions || {};
  const client = factory(clientOptions);
  if (!client || typeof client.login !== "function") throw new TypeError("clientFactory must return an FCA client");
  const api = await client.login(normalizeCredentials(credentials), options.loginOptions || {});
  return new MessengerBot(client, api, options);
}

module.exports = { MessengerBot, createMessengerBot };
