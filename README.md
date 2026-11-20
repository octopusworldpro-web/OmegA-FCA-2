# OmegA Bot — OmegA-FCA

**An experimental, AppState-first personal Messenger client and FCA compatibility layer by NirZon.**

OmegA-FCA is the Facebook integration library maintained under the **OmegA Bot** brand by **NirZon**.

 > **Status:** experimental native personal-account path. AppState session validation, MQTT/WebSocket bootstrap, a limited event normalizer, a limited action set, and GoatBot callback compatibility are implemented with synthetic tests. This is not yet a verified drop-in FCA replacement: live Facebook broker acceptance, complete event/action parity, and authorized-account end-to-end tests remain outstanding.

**Package:** `@nirzon-islam/omega-fca` · **Node.js:** 20+ · **Author:** NirZon

## Included

- AppState/cookie validation, secure encrypted session storage, secret redaction.
- `createDiagnosticRecorder()`: bounded request metadata reports that omit header values, query values, body values, response bodies and credentials.
- Native personal-session bootstrap for owner-supplied AppState, including HTTPS-only Facebook/Messenger requests, cookie rotation, and checkpoint/expiry detection.
- `createFacebookWebClient()`: bounded authenticated GET/POST/HEAD request layer, session-token injection for POST forms, redirect challenge classification, response normalization, and request/response size limits. It deliberately requires caller-supplied verified paths and payload schemas.
- AppState/cookie login is the only enabled login path in this phase. Direct email/username-password and 2FA login attempts are rejected before the authentication provider is called; credential login is deferred.
- Checkpoint/session-expiry classification. Challenges must be resolved by the account owner.
- Connection supervision, bounded reconnect/backoff and event dispatch.
- Bounded realtime binary-frame envelope inspection based on observed captures.
- Experimental Facebook Messenger MQTT 3.1 transport adapter using public FCA observations: `edge-chat.facebook.com/chat`, broker handshake, subscriptions and sync-queue bootstrap. Event normalization and live validation remain incomplete.
- `createFacebookMqttClient()`: first-party AppState-only client factory that wires the native personal-session bootstrap, MQTT driver, reconnect supervisor and GoatBot-style `listenMqtt` facade. Supply a WebSocket implementation; real Facebook broker acceptance is not yet verified.
- `inspectRealtimeSyncEnvelope()`: parses the captured outer sync JSON envelope and nested payload with size/type checks; it does not infer the unknown binary prefix or protocol semantics.
- `createLegacyFcaProvider()`: adapter for an existing callback-style personal-account FCA implementation.
- `createGoatBotLogin()`: callback-style GoatBot login adapter.
- Personal-account driver method forwarding for messaging, threads, reactions, typing, and group actions when the supplied FCA implementation supports those methods.
- Separate official Meta Messenger Page transport (not a personal-account replacement).
- TypeScript declarations, signed update-manifest verification, optional Ed25519 licensing.

## Automatic encrypted SessionGuard

The first-party native MQTT driver can persist the currently authenticated AppState without requiring a separate manual guard lifecycle. This is opt-in and requires an owner-managed encryption key; the library never generates or writes the key.

```js
const client = createFacebookMqttClient({
  sessionGuard: {
    filePath: "./private/facebook-session.enc",
    key: process.env.FCA_SESSION_KEY, // exactly 64 hex chars or a 32-byte Buffer
    intervalMs: 60_000
  }
});
```

After MQTT setup succeeds, the driver writes an encrypted snapshot immediately and then periodically. It keeps a verified encrypted backup, exposes `api.sessionGuard()` for safe path/save access, and `api.stopSessionGuard()` for a final save. Normal logout also stops the timer and attempts a final save. On a later process start, call `client.login({ mode: "session" })` to restore the encrypted snapshot, revalidate it with Facebook, and reconnect MQTT without re-entering AppState. Keep the key outside the repository and backups; losing the key makes the encrypted snapshots unrecoverable. Do not put it in `config.json`, `account.txt`, logs, or CI output.\n\nFor an existing GoatBot deployment, the same optional configuration can be supplied through `FCA_SESSION_FILE`, `FCA_SESSION_KEY`, and `FCA_SESSION_INTERVAL_MS` environment variables. FCA accepts GoatBot's legacy `sessionGuard(account.txt, options)` call as an activation alias only; encrypted data remains in the separately configured encrypted file and its backup. The plaintext `account.txt` is never overwritten by SessionGuard. See [deployment notes](docs/DEPLOYMENT.md).

## GoatBot account configuration

The current authentication phase is **AppState-only**. Email/password and username/password login are deferred and are not loaded from configuration or environment variables.

Put only an authorized cookie export in the project-root `account.txt`. Accepted formats are:
- Raw cookie header (`c_user=...; xs=...`).
- Netscape cookie export.
- JSON cookie array.

Alternatively, put a JSON cookie array in `appstate.json`. A non-empty `account.txt` takes precedence. Credential-like key/value text in `account.txt` is rejected. The loader deliberately does not fall back to `fb_email`, `fb_username`, passwords, 2FA values, or `FB_*` environment variables.

`account.txt`, `appstate.json`, passwords, cookies, 2FA seeds, and session keys must stay private and must not be committed. Email/password authentication will be implemented as a separate later phase; it is not available in this AppState-only release path.

## Personal AppState session foundation

The first native session layer can validate an owner-supplied AppState and issue bounded HTTPS requests only to Facebook/Messenger hosts. It preserves scoped response cookies and stops with an explicit checkpoint or expired-session error; it does not bypass either state.

```js
const { createPersonalSession } = require("@nirzon-islam/omega-fca");
const session = await createPersonalSession({ appState: require("./account.json") });
const response = await session.request("https://www.facebook.com/");
console.log(session.userId, response.status);
// Call session.close() when finished.
```

This is a session foundation only: it does not yet provide the full FCA action API or realtime listener.

## Experimental Messenger MQTT transport

`createFacebookMqttClient()` provides the first-party AppState-only path: it validates the supplied session, opens the native WebSocket/MQTT transport, subscribes and initializes sync, and exposes a GoatBot-style callback listener. Known Messenger delta classes are normalized conservatively; unknown classes remain explicit. A limited set of web/thread and MQTT actions is available, but this is not full FCA parity. The private broker protocol, delta schemas, and action payloads are unofficial and have not been validated against a live Facebook account. See [Facebook MQTT transport notes](docs/FACEBOOK-MQTT-TRANSPORT.md) and [implementation status](docs/IMPLEMENTATION-STATUS.md).

## Realtime frame inspection

The Android Messenger Web capture confirmed a successful `/ws/realtime` WebSocket handshake and binary frames containing a JSON-like `events` envelope with `name` and `args` fields. OmegA-FCA now includes `decodeRealtimeFrame()` and `summarizeRealtimeFrame()` for bounded inspection of that observed envelope. The undocumented binary prefix remains opaque; this is not yet a socket client, authentication flow, subscription/acknowledgement implementation, event semantic map, message sender, or E2EE implementation. See [Realtime frame evidence](docs/REALTIME-FRAME-EVIDENCE.md).

## Safe diagnostic reports

A secret-safe diagnostic recorder is available for the current AppState-backed session layer. It records request structure and response metadata, not secrets or payload contents. See [Safe diagnostics](docs/SAFE-DIAGNOSTICS.md) for usage.

**Important:** this currently instruments AppState session requests only. It cannot capture a username/password login trace because native Facebook credential login is not implemented yet.

## Legacy compatibility adapter (temporary migration/test utility)

The adapter is a temporary migration/test utility for AppState-backed sessions. It lets an existing FCA implementation plug into OmegA-FCA without pretending that the Facebook protocol has been reimplemented:

```js
const { createClient, createLegacyFcaProvider } = require("@nirzon-islam/omega-fca");
// Supply a caller-owned FCA implementation only when testing the migration adapter.
const legacyFcaLogin = require("your-existing-fca");

const authenticate = createLegacyFcaProvider({
  login: legacyFcaLogin,
  options: { forceLogin: false }
});
const client = createClient({ authenticate });

const api = await client.login({
  mode: "appstate",
  appState: require("./account.json")
});
api.listenMqtt((error, event) => {
  if (error) console.error("FCA listener error:", error.message);
  else if (event) console.log("Event:", event.type);
});
```

Use only an account and session you own or are authorized to operate. Keep `account.json`, passwords, 2FA secrets, and session keys outside source control. If Facebook presents a checkpoint, resolve it through Facebook as the account owner and then retry with a fresh authorized session.

This adapter is optional and is not required by the first-party `createFacebookMqttClient()` path.

## Remaining standalone-replacement gates

- Native username/password authentication and owner-controlled 2FA/checkpoint continuation are deferred; AppState/cookie is the only native login path in this phase.
- Full Messenger event normalization, attachment handling, and the complete legacy FCA action catalog are not implemented.
- Facebook MQTT broker acceptance, event delivery, message send, reconnect recovery, and group operations still need authorized live-account verification.
- Complete legacy FCA behavior parity and GoatBot integration tests must pass before production migration.

Do not treat this experimental release as a drop-in production replacement until those gates pass. The official Meta Page transport is separate and does not satisfy personal-profile or group-chat requirements.

## Security

Never commit cookies, AppState, passwords, 2FA secrets, encryption keys, or tokens. The library does not bypass checkpoints, 2FA, rate limits, or platform security controls. Unofficial interfaces may change and may result in account restrictions.

## AppState-first test run

Email/password login is deferred for the current testing phase. To validate an authorized AppState session, place only the cookie export in the project-root `account.txt` (or `appstate.json`) and run:

~~~bash
npm ci
npm test
npm run test:syntax
npm run test:appstate
~~~

The live AppState check prints only the account ID and session status; it does not print cookies. It validates the HTTPS session bootstrap only—not Messenger realtime, message sending, or full GoatBot compatibility. See [AppState deployment/test instructions](docs/DEPLOYMENT.md).

## Development

```bash
npm ci
npm test
npm run test:syntax
npm pack --dry-run
```

## Ownership

**OmegA Bot** — developed and maintained by **NirZon**.

MIT License. See [LICENSE](LICENSE).


## Browser-based protocol capture

OmegA-FCA includes an owner-operated Playwright capture utility. On desktop it launches Chromium; on Android/Termux it can attach to an already-running Android Chrome browser through CDP when that browser exposes a debugging endpoint. Setup and privacy guidance: [Browser Capture](docs/BROWSER-CAPTURE.md).

Desktop:

```sh
npm install --no-save playwright
npx playwright install chromium
npm run capture:browser
```

Android/Termux: run `bash tools/termux-capture-setup.sh`, pair/connect ADB Wireless debugging, forward Chrome's DevTools socket, then run `npm run capture:browser -- --cdp http://127.0.0.1:9222`. Lemur/other browser compatibility is not assumed; verify the CDP endpoint first.

The browser runs locally; it is not remotely visible to ChatGPT. The default report omits cookies, query strings, request/response bodies, and binary frame contents. An explicit `--save-private-frames` option stores raw WebSocket frames locally for owner-only inspection; those files may contain secrets or private messages and must not be shared unredacted.
