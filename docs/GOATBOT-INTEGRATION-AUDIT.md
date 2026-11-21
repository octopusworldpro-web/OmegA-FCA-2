# GoatBot integration audit

**Target:** `nirzon-islam/OmegA-Goatbot`  
**GoatBot branch reviewed:** `fca-migration-cleanup`  
**OmegA-FCA branch:** `prerelease/0.1.6-rc.3`  
**Review status:** source-level login/lifecycle audit updated 2026-11-21; full call-site parity and live Facebook acceptance remain incomplete.

## Verified current GoatBot integration

The reviewed GoatBot branch imports the first-party OmegA-FCA package through `bot/login/omegaFca.js` and constructs `createFacebookMqttClient()`. The current dependency pin in GoatBot `package.json` is `@nirzon-islam/omega-fca@0.1.6-rc.2`; therefore the SessionGuard changes on this prerelease branch are not yet present in the deployed Bot package.

The login module invokes the callback form:

```js
login({ appState }, options, callback)
```

The successful callback is expected to provide an API object with at least:

- `getCurrentUserID()`
- `listenMqtt(callback)`
- `stopListening(callback?)`

Additional API surface used or explicitly probed:

- `sessionGuard(accountPath, options)`
- `stopSessionGuard()`
- `setOptions(options)` (optional)
- `e2ee.isConnected()` (optional; no E2EE implementation is claimed)

The native facade now emits a `ready` event after the synthetic/driver MQTT setup path completes CONNACK and topic subscription. This readiness signal is covered by synthetic tests; Facebook live broker acceptance and event compatibility are not proven.

## Existing account and recovery contract

- GoatBot reads JSON AppState from its project-root `account.txt` and passes it to the callback login adapter.
- Account switching validates the new AppState against the requested Facebook account ID, establishes a candidate API/listener, then atomically replaces the account file.
- Existing `account.txt`, account-switch behavior, and Bot-required configuration/credentials are authoritative and must not be removed, renamed, rotated, or replaced by FCA migration.
- FCA now supports the existing `sessionGuard(account.txt, { interval, debounce })` call as an activation alias for a separately configured encrypted sidecar. It never reads or writes encrypted bytes to `account.txt`; the legacy interval is honored.
- Optional deployment variables are `FCA_SESSION_FILE`, `FCA_SESSION_KEY`, and `FCA_SESSION_INTERVAL_MS`. They are not required. If absent, existing plaintext AppState login continues unchanged.
- The encrypted file and its backup are rejected if either resolves to the Bot's root `account.txt`.

## Current native FCA capabilities

- AppState/cookie HTTPS session validation and checkpoint/expiry classification.
- First-party native WebSocket/MQTT driver, CONNACK and topic-subscription readiness, connection supervision, reconnect primitives, event normalization for observed delta shapes, and an experimental text/sticker/reply send task.
- Thread/user query and a limited set of group/reaction/read actions based on public FCA observations.
- Optional encrypted SessionGuard snapshots, backup recovery, account-ID verification, periodic saves, and encrypted restore mode.
- GoatBot callback login, ready-event and listener lifecycle facade.

These capabilities are implemented in code but Facebook-specific private endpoints, broker acceptance, and action payload schemas are unofficial and still require authorized live-account verification.

## Partial command-call inventory (2026-11-21)

A source scan of GoatBot command modules found calls to `getAppState` and low-level `httpPost` in addition to the earlier login/listener methods. These are now exposed by OmegA-FCA: `getAppState` returns the current owner session cookies and must remain owner-only; `httpPost` uses the authenticated bounded web client and only permits Facebook/Messenger HTTPS hosts. The native driver also exposes `refreshFb_dtsg` for authenticated token refresh and `markAsDelivered` for the delivery receipt behavior used by GoatBot's event handler.

The scan also found calls to `unsendMessage`, `changeGroupImage`, `changeAvatar`, `setTitle`, `changeThreadEmoji`, `changeThreadColor`, `shareContact`, and `setOptions`. FCA now implements `unsendMessage`, `setTitle`, `changeThreadEmoji`, `changeThreadColor`, and the legacy-compatible `sendTypingIndicator` with synthetic request tests. `changeGroupImage`, `changeAvatar`, `shareContact`, and the runtime semantics of `setOptions` remain unimplemented or unverified. This remains a partial scan, not a full repository-wide inventory.

## Confirmed remaining compatibility gaps

1. GoatBot currently pins the previously published `0.1.6-rc.2` package. This branch is not active in the Bot until a deliberate package release and dependency/lockfile update.
2. The complete set of methods called by every GoatBot command, event, dashboard, database and custom script has not yet been inventoried. This audit does not claim full FCA API parity.
3. Full attachment upload/download, all event types and legacy event argument shapes are not implemented or verified.
4. `createNewGroup` is not exposed until its request contract is evidenced.
5. E2EE is not implemented.
6. Native Facebook username/email-password login is deferred by the current project decision. The current test path is owner-controlled AppState; Facebook checkpoints remain owner-resolved.
7. No authorized live-account test has yet verified MQTT connect, message receive, message send delivery, group actions, reconnect after network loss, or session expiry/recovery.

## Verification gate

Before production migration:

- Run the full OmegA-FCA Node 20/22 CI matrix on the latest prerelease head.
- Run GoatBot's existing secure-session tests and a startup/contract test against the intended package version.
- Complete a source-level inventory of every FCA method/event used by GoatBot and implement verified equivalents without dummy success responses.
- Use the owner-operated `npm run test:messenger-mqtt` acceptance command with an AppState the owner controls. Verify readiness and inbound events; only send an outbound test message with explicit opt-in to a thread the owner controls.
- Verify reconnect, listener teardown, account switching, and encrypted-session recovery.
- Do not merge/publish as production-ready until those gates pass.

## Security and scope

Never put live cookies, AppState, passwords, 2FA material, or session keys in tests, commits, logs, or CI artifacts. Checkpoints and 2FA challenges remain owner-controlled. Preserve every Bot-required credential and configuration value; do not rotate, remove, rename, or replace them as part of FCA integration.
