"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionSupervisor } = require("../src/runtime/connection");

test("supervisor retries transient connection failures with bounded backoff", async () => {
  let attempts = 0;
  const delays = [];
  const driver = { listen() { return () => {}; } };
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      attempts++;
      if (attempts < 3) throw new Error("temporary network failure");
      return driver;
    },
    options: { minDelayMs: 10, maxDelayMs: 20, factor: 2, jitter: 0, maxAttempts: 3 },
    sleep: async ms => delays.push(ms)
  });

  assert.equal(await supervisor.start(), driver);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(supervisor.snapshot(), { state: "connected", connected: true, generation: 3 });
  await supervisor.stop();
});

test("supervisor does not retry a non-retryable authentication failure", async () => {
  let attempts = 0;
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      attempts++;
      const error = new Error("invalid session");
      error.retryable = false;
      throw error;
    },
    options: { maxAttempts: 5 },
    sleep: async () => assert.fail("non-retryable failure must not sleep")
  });

  assert.equal(await supervisor.start(), null);
  assert.equal(attempts, 1);
  assert.equal(supervisor.snapshot().state, "failed");
  await supervisor.stop();
});

test("stopping during an in-flight connect aborts and disposes a late driver", async () => {
  let resolveConnect;
  let disconnected = 0;
  let signal;
  const supervisor = new ConnectionSupervisor({
    connect: ({ signal: connectSignal }) => {
      signal = connectSignal;
      return new Promise(resolve => { resolveConnect = resolve; });
    },
    disconnect: async () => { disconnected++; },
    options: { maxAttempts: 1 }
  });

  const starting = supervisor.start();
  await new Promise(resolve => setImmediate(resolve));
  await supervisor.stop();
  assert.equal(signal.aborted, true);
  resolveConnect({ listen() {} });

  assert.equal(await starting, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disconnected, 1);
  assert.equal(supervisor.snapshot().state, "stopped");
});

test("listener errors detach the old driver and reconnect before reattaching", async () => {
  const listeners = [];
  let connects = 0;
  let disconnects = 0;
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      connects++;
      return {
        listen(callback) {
          listeners.push(callback);
          return () => {};
        },
        disconnect: async () => { disconnects++; }
      };
    },
    disconnect: async driver => driver.disconnect(),
    options: { minDelayMs: 0, maxDelayMs: 0, jitter: 0, maxAttempts: 1 },
    sleep: async () => {}
  });

  await supervisor.start();
  const events = [];
  supervisor.listen(event => events.push(event));
  listeners[0](new Error("socket closed"));
  for (let i = 0; i < 20 && listeners.length < 2; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(connects, 2);
  assert.equal(disconnects, 1);
  assert.equal(listeners.length, 2);
  listeners[1](null, { type: "message", messageID: "m-2" });
  assert.deepEqual(events, [{ type: "message", messageID: "m-2" }]);
  await supervisor.stop();
});

test("supervisor allows only one active listener and detaches idempotently", async () => {
  let attached = 0;
  let detached = 0;
  const supervisor = new ConnectionSupervisor({
    connect: async () => ({
      listen() {
        attached++;
        return () => { detached++; };
      }
    }),
    options: { maxAttempts: 1 }
  });

  await supervisor.start();
  const stopListening = supervisor.listen(() => {});
  assert.throws(() => supervisor.listen(() => {}), /already attached/);
  stopListening();
  stopListening();
  assert.equal(attached, 1);
  assert.equal(detached, 1);
  await supervisor.stop();
});


test("application listener exceptions are isolated without reconnecting the transport", async () => {
  let connects = 0;
  const callbackFailure = new Error("synthetic application handler failure");
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      connects++;
      return { listen(callback) { this.emitEvent = callback; return () => {}; } };
    },
    options: { maxAttempts: 1 }
  });

  const driver = await supervisor.start();
  const callbackErrors = [];
  supervisor.on("listenerCallbackError", error => callbackErrors.push(error));
  supervisor.listen(() => { throw callbackFailure; });
  driver.emitEvent(null, { type: "message", messageID: "synthetic-callback-error" });

  assert.deepEqual(callbackErrors, [callbackFailure]);
  assert.equal(connects, 1);
  assert.equal(supervisor.snapshot().state, "connected");
  await supervisor.stop();
});



test("stopping during listener recovery prevents the supervisor from restarting", async () => {
  let connectCount = 0;
  let listener;
  let releaseDisconnect;
  let disconnectStarted;
  const disconnectGate = new Promise(resolve => { releaseDisconnect = resolve; });
  const disconnectSignal = new Promise(resolve => { disconnectStarted = resolve; });
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      connectCount++;
      return {
        listen(callback) { listener = callback; return () => {}; },
        disconnect: async () => {
          disconnectStarted();
          await disconnectGate;
        }
      };
    },
    disconnect: driver => driver.disconnect(),
    options: { maxAttempts: 1 }
  });

  await supervisor.start();
  supervisor.listen(() => {});
  listener(new Error("synthetic listener failure"));
  await disconnectSignal;
  let stopSettled = false;
  const stopping = supervisor.stop().finally(() => { stopSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopSettled, false, "stop must wait for recovery to dispose the old driver");
  releaseDisconnect();
  await stopping;

  assert.equal(connectCount, 1);
  assert.equal(supervisor.snapshot().state, "stopped");
  assert.equal(supervisor.snapshot().connected, false);
});



test("supervisor reaches stopped state even when driver disposal fails", async () => {
  const failure = new Error("synthetic disconnect failure");
  const supervisor = new ConnectionSupervisor({
    connect: async () => ({ listen() {} }),
    disconnect: async () => { throw failure; },
    options: { maxAttempts: 1 }
  });
  await supervisor.start();
  await assert.rejects(supervisor.stop(), error => error === failure);
  assert.deepEqual(supervisor.snapshot(), {
    state: "stopped",
    connected: false,
    generation: 2
  });
});


test("start waits for an in-flight stop to finish disposing the previous driver", async () => {
  let connectCount = 0;
  let releaseDisconnect;
  const disconnectGate = new Promise(resolve => { releaseDisconnect = resolve; });
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      connectCount++;
      return { listen() {} };
    },
    disconnect: async () => disconnectGate,
    options: { maxAttempts: 1 }
  });

  await supervisor.start();
  const stopping = supervisor.stop();
  const restarting = supervisor.start();

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connectCount, 1);

  releaseDisconnect();
  await stopping;
  const driver = await restarting;

  assert.ok(driver);
  assert.equal(connectCount, 2);
  assert.deepEqual(supervisor.snapshot(), {
    state: "connected",
    connected: true,
    generation: 3
  });
  await supervisor.stop();
});


test("stop aborts a pending connect and disposes a driver that resolves late", async () => {
  let resolveConnect;
  let releaseDisconnect;
  let disconnectStarted;
  let stopSettled = false;
  let connectSignal;
  const connectGate = new Promise(resolve => { resolveConnect = resolve; });
  const disconnectGate = new Promise(resolve => { releaseDisconnect = resolve; });
  const disconnectSignal = new Promise(resolve => { disconnectStarted = resolve; });
  const supervisor = new ConnectionSupervisor({
    connect: ({ signal }) => {
      connectSignal = signal;
      return connectGate;
    },
    disconnect: async () => {
      disconnectStarted();
      await disconnectGate;
    },
    options: { maxAttempts: 1 }
  });

  const starting = supervisor.start();
  await new Promise(resolve => setImmediate(resolve));
  const stopping = supervisor.stop().finally(() => { stopSettled = true; });
  await stopping;
  assert.equal(connectSignal.aborted, true);
  assert.equal(await starting, null);
  assert.equal(stopSettled, true);

  resolveConnect({ listen() {} });
  await disconnectSignal;
  assert.equal(stopSettled, true);
  releaseDisconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(supervisor.snapshot(), {
    state: "stopped",
    connected: false,
    generation: 2
  });
});


test("stop aborts a pending reconnect backoff immediately", async () => {
  let attempts = 0;
  let backoffSignal;
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      attempts++;
      throw Object.assign(new Error("temporary network failure"), { retryable: true });
    },
    options: { minDelayMs: 30000, maxDelayMs: 30000, jitter: 0, maxAttempts: 3 },
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      backoffSignal = signal;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  const starting = supervisor.start();
  for (let i = 0; i < 20 && !backoffSignal; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(backoffSignal);
  const stopping = supervisor.stop();
  assert.equal(backoffSignal.aborted, true);
  await stopping;
  assert.equal(await starting, null);
  assert.equal(attempts, 1);
  assert.equal(supervisor.snapshot().state, "stopped");
});

test("rejects unsafe reconnect policy values", () => {
  for (const options of [
    { maxAttempts: 0 },
    { minDelayMs: -1 },
    { maxDelayMs: 1, minDelayMs: 2 },
    { factor: 0.5 },
    { jitter: 1.1 },
    { maxAttempts: 101 }
  ]) {
    assert.throws(() => new ConnectionSupervisor({ connect: async () => ({}), options }), /Invalid connection retry options/);
  }
});
