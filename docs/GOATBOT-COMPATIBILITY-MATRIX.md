# GoatBot compatibility matrix

**Target:** `nirzon-islam/OmegA-Goatbot`  
**GoatBot branch reviewed:** `fca-migration-cleanup`  
**OmegA-FCA branch:** `public-package`  
**Status:** Native AppState/MQTT integration wired on the working branch; live acceptance and full FCA parity are still unverified.

This matrix separates what the current OmegA-FCA facade exposes from what still requires a real transport and end-to-end verification. A method appearing in the facade means only that the injected driver supplied it; it does not mean Facebook behavior is implemented by this package.

## Login and lifecycle

| GoatBot expectation | Current OmegA-FCA status | Notes |
|---|---|---|
| `login({ appState }, options, callback)` / `login({ mode: "session" })` | Native AppState + encrypted saved-session restore | `createGoatBotLogin` maps AppState arrays to `createFacebookMqttClient`; explicit `mode: "session"` restores an encrypted snapshot when SessionGuard is configured. Native HTTPS validation and MQTT setup run before callback success. Real-account acceptance is still pending. |
| `getCurrentUserID()` | Conditional | Exposed after login; returns the driver identity converted to a string, or null. |
| `listenMqtt(callback)` | Native adapter wired | Adapts the native driver's `listen` to error-first `(error, event)` and emits a `ready` event after successful MQTT setup. Live event compatibility remains unverified. |
| `stopListening(callback?)` | Implemented at facade boundary | Detaches the active listener and invokes an optional callback. |
| `sessionGuard(path, options)` | Encrypted native-driver guard available via configuration | `createFacebookMqttClient({ sessionGuard: { filePath, key, intervalMs } })` enables immediate/periodic encrypted AppState snapshots and a verified backup. The key must be supplied securely by the owner; no key is generated or committed. |
| `stopSessionGuard()` | Implemented by native driver | Stops periodic snapshots, performs a final encrypted save, and closes the guard. Normal client logout also runs this cleanup. |
| `setOptions(options)` | Pass-through only | Exposed only if supplied by the driver. |
| `e2ee.isConnected()` | Not implemented | No E2EE implementation in this branch. |

## Conditional driver API

The client exposes each method below only when the injected driver provides that function. No successful Facebook action is implied by the method name.

| Method | License feature gate (when licensing enabled) | Current status |
|---|---|---|
| `sendMessage`, `unsendMessage`, `markAsRead`, `sendTypingIndicator` | `messaging` | Driver pass-through only |
| `getUserInfo`, `getThreadInfo`, `getThreadList`, `getThreadHistory`, `getMessage`, `getFriendsList`, `getUserID` | `threads` | Driver pass-through only |
| `addUserToGroup`, `removeUserFromGroup`, `createNewGroup`, `changeNickname` | `groups` | Driver pass-through only |
| `setMessageReaction` | `reactions` | Driver pass-through only |

## Required work before migration

- Complete live validation of the owner-supplied AppState session; username/password and 2FA login remain deferred, and checkpoint resolution remains manual.
- Implement HTTP action serialization, response/error normalization, and safe retry policy. Do not automatically retry non-idempotent sends.
- Validate native MQTT frame decoding, event normalization, readiness, reconnect and deterministic shutdown against an authorized account; synthetic fake-broker coverage is not live acceptance.
- Inventory every FCA call site across GoatBot commands, events, dashboard, database and custom scripts; this document is not a complete call-site inventory.
- Add contract tests for every required method and callback shape, then opt-in integration tests using an authorized test account.
- Verify CI on the target branch and run GoatBot's own tests before considering a dependency switch.

## Release decision

**Do not treat the working branch as production-accepted until an authorized live account test passes.** AppState session setup and native MQTT transport are now wired, but private Facebook endpoint behavior, message delivery, complete API parity, E2EE, and all call-site coverage remain unverified or unimplemented. Never put live AppState, cookies, passwords, 2FA material, or session keys in fixtures, logs, commits, or CI.


## Working-branch integration update

The GoatBot `fca-migration-cleanup` branch now uses the first-party
`createFacebookMqttClient()` factory through `createGoatBotLogin`. The
`@eryxenx/fca` dependency has been removed from that branch, and OmegA-FCA
owns its WebSocket runtime through its package dependency.

This is a native code-path integration milestone, not live acceptance. The
Facebook-specific MQTT handshake, task schemas, event deltas, and private web
action endpoints remain experimental until an authorized live account test
proves login readiness, message receive/send, and recovery.


## Integration audit: GoatBot `fca-migration-cleanup` (2026-11-21)

A direct read of the target branch found integration gaps that must be closed before claiming the new driver is active in GoatBot:

- GoatBot's `package.json` currently pins `@nirzon-islam/omega-fca` to `0.1.6-rc.2`. That is the published package from the original OmegA-FCA repository, not this FCA-2 feature branch. Changes in this PR do not reach the running bot until they are synchronized/released and the GoatBot dependency plus lockfile are deliberately updated.
- `bot/login/omegaFca.js` creates the client without a `sessionGuard` configuration or an owner-managed encryption key.
- `bot/login/login.js` calls `api.sessionGuard(account.txt, { interval, debounce })`. The native SessionGuard instead requires a separately configured encrypted snapshot path and explicit key; it must not overwrite plaintext `account.txt`. The caller must use `api.sessionGuard()` only after configuring the guard in the client factory, and must await `api.stopSessionGuard()` during shutdown/recovery.
- The current GoatBot startup path requires `account.txt` and always supplies AppState. To use encrypted restart recovery, the integration must fall back to `client.login({ mode: "session" })` when the owner-provided AppState file is absent, while preserving the explicit account-ID check and fresh-session recovery path.
- The current GoatBot config file tracked on the reviewed branch contains plaintext third-party credentials/secrets. Rotate those values, remove them from the tracked config, and move runtime values into deployment secrets. Removing them from the latest file alone does not purge Git history.

These are release blockers, not claims of completed integration. Keep the GoatBot dependency unchanged until this branch's CI and the synchronized package release are verified.
