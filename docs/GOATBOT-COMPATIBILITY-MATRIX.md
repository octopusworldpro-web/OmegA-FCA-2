# GoatBot compatibility matrix

**Target:** `nirzon-islam/OmegA-Goatbot`  
**GoatBot branch reviewed:** `fca-migration-cleanup`  
**OmegA-FCA branch:** `main` (package `0.1.6-rc.3`)  
**Status:** Full 271-JavaScript-file GoatBot call-site audit completed on 2026-11-21. Native AppState/MQTT integration is wired; live acceptance and complete FCA parity remain unverified. See [complete call-site inventory](GOATBOT-CALLSITE-INVENTORY.md).

This matrix separates what the current OmegA-FCA facade exposes from what still requires a real transport and end-to-end verification. See [Messenger event compatibility](GOATBOT-EVENT-COMPATIBILITY.md) for the normalized legacy event contract. A method appearing in the facade means only that the injected driver supplied it; it does not mean Facebook behavior is implemented by this package.

## Login and lifecycle

| GoatBot expectation | Current OmegA-FCA status | Notes |
|---|---|---|
| `login({ appState }, options, callback)` | Native AppState path wired | `createGoatBotLogin` maps AppState arrays to `createFacebookMqttClient`; native HTTPS session validation and MQTT setup run before callback success. Login-time `listenEvents`, `listenTyping`, `updatePresence`, `selfListen`, `selfListenEvent`, `autoMarkDelivery`, `autoMarkRead`, `online`, and `userAgent` options are now forwarded to the native driver. Real-account acceptance is still pending. |
| `getCurrentUserID()` | Native | Returns the authenticated account ID. |
| `getAppState()` | Native, sensitive | Returns the current cookie/AppState array for owner-only legacy commands such as `getfbstate`; never log or expose it to ordinary users. |
| `getCookies()` | Native, sensitive | Returns the Facebook cookie header for legacy commands such as `suspend`; treat it as a credential, never log or expose it to ordinary users. |
| `refreshFb_dtsg()` | Native | Refreshes Facebook web request tokens from the authenticated session without re-login; returns token names/timestamp only, never token values. |
| `listenMqtt(callback)` | Native adapter wired | Adapts the native driver's `listen` to error-first `(error, event)` and emits a `ready` event after successful MQTT setup. Live event compatibility remains unverified. |
| `getHumanizer()` | Native compatibility middleware | Returns the native humanizer after `listenMqtt()` starts. Supports `enabled`, `reactDelayMs`, `cooldownMs`, `maxPerMinute`, and `perThread`; shows typing for the exact configured delay before delivering incoming messages. |
| `stopListening(callback?)` | Implemented at facade boundary | Detaches the active listener and invokes an optional callback. |
| `sessionGuard(path, options)` | Native encrypted sidecar, opt-in | Preserves GoatBot’s legacy `account.txt` argument as an activation alias; the actual encrypted snapshot and backup live at `FCA_SESSION_FILE`, never in `account.txt`. The legacy `interval` option is honored; `debounce` is accepted but does not change periodic snapshot behavior. |
| `stopSessionGuard()` | Native encrypted guard lifecycle | Stops periodic saves, performs a final encrypted save, and closes the guard. |
| `setOptions(options)` | Native runtime event options | Supports `logLevel`, `selfListen`, `selfListenEvent`, `listenEvents`, `listenTyping`, `updatePresence`, `autoMarkDelivery`, and `autoMarkRead`; rejects unknown options instead of silently ignoring them. |
| `_connectE2EEAndMerge()` | Not implemented | GoatBot conditionally probes this private hook in `bot/login/loadData.js`; FCA-2 reports `getCapabilities().e2ee === false` and does not expose it. |

## Legacy listener option behaviour

The first-party native driver receives GoatBot's login-time options and applies event filters before forwarding events:
- `selfListen` controls messages authored by the authenticated account.
- `listenEvents` controls non-self thread/group events; `selfListenEvent` independently controls events authored by the authenticated account.
- `listenTyping` and `updatePresence` control typing and presence events.
- `autoMarkDelivery` and `autoMarkRead` opt into corresponding receipt actions for incoming message events.
- `setOptions()` can update the supported runtime filters after login. Unknown options are rejected.
- `userAgent` is forwarded to the native HTTP and MQTT session setup. Proxy login is explicitly unsupported; it is not silently ignored.

These filters operate on the currently normalized observed delta classes. Complete event-shape parity still requires authorized live-account verification.

## Encrypted SessionGuard deployment compatibility

The FCA factory accepts optional `FCA_SESSION_FILE`, `FCA_SESSION_KEY`, and `FCA_SESSION_INTERVAL_MS` environment variables. This lets the existing GoatBot `omegaFca.js` client construction remain unchanged. Its current `sessionGuard(account.txt, { interval, debounce })` call activates the configured encrypted sidecar and honors `interval`; it never reads, truncates, replaces, or writes encrypted data to `account.txt`. The encrypted primary and `.bak` backup are rejected if either resolves to the Bot's root `account.txt`.

If these optional variables are not configured, SessionGuard remains disabled and the Bot's existing plaintext AppState flow is unchanged. Do not change Bot-required credentials or tracked configuration to enable this optional feature.

## Conditional driver API

The client exposes each method below only when the injected driver provides that function. No successful Facebook action is implied by the method name.

| Method | License feature gate (when licensing enabled) | Current status |
|---|---|---|
| `sendBroadcast` | `messaging` | Bounded parallel-batch broadcast with per-recipient results and callback support; synthetic helper tests added. |
| `sendMessage` | `messaging` | Text/sticker/reply via native MQTT; attachment and URL sends via authenticated legacy Messenger upload/send flow. Synthetic upload/send tests exist; live broker/recipient acceptance remains unverified. |
| `markAsRead`, `markAsReadAll`, `markAsSeen` | `messaging` | Native authenticated receipt actions with synthetic request/response tests; live endpoint acceptance is unverified. |
| `deleteMessage` | `messaging` | Native delete-for-me endpoint, deliberately distinct from `unsendMessage`; synthetic tests exist, live acceptance is unverified. |
| `deleteThread`, `muteThread`, `changeArchivedStatus` | `threads` | Native authenticated thread actions (single/multiple IDs where supported) with synthetic tests; live acceptance is unverified. |
| `unsendMessage` | `messaging` | Native authenticated unsend endpoint with synthetic success/error tests; live acceptance is unverified. |
| `markAsDelivered` | `messaging` | Native authenticated delivery-receipt endpoint with synthetic tests; live acceptance is unverified. |
| `sendTypingIndicator` | `messaging` | Native authenticated typing endpoint; supports the legacy FCA argument order and the simpler thread/state form, with synthetic tests. Live acceptance is unverified. |
| `getUserID(name)`, `getUID(profile)` | `threads` | Native typeahead user search and Facebook profile URL/numeric-ID resolution; synthetic tests added. `getUserID()` with no argument is not a current-account alias; use `getCurrentUserID()`. |
| `resolvePhotoUrl(photoID)` | `threads` | Native authenticated Mercury photo URL lookup with HTTPS Facebook CDN host validation. |
| `getUserInfo`, `getThreadInfo`, `getThreadList`, `getThreadHistory` | `threads` | Native AppState-backed web actions with synthetic tests; live Facebook endpoint behavior is unverified. |
| `httpPost` | compatibility | Authenticated low-level POST is exposed, but no direct `api.httpPost()` call was found in the complete scan of the reviewed GoatBot branch. |
| `getMessage` | `threads` | Implemented by looking up the requested ID in the latest 100 normalized thread-history messages; callback and Promise forms are supported. Older messages may require a future cursor-based lookup. |
| `editMessage` | `messaging` | Native MQTT task builder + correlated response parser; synthetic request/response test added. Live edit acceptance and old-message rejection still require owner testing. |
| `shareContact` | `messaging` | Native MQTT contact-sharing task builder with correlated response; accepts GoatBot's legacy fourth message-ID argument as an ignored compatibility placeholder. Live acceptance is unverified. |
| `getFriendsList` | `threads` | Native authenticated `/chat/user_info_all` query with normalized friend metadata; synthetic tests added. Live endpoint acceptance is unverified. |
| `getUserID(name)` | `threads` | Native typeahead lookup exists; GoatBot uses `getCurrentUserID()` for its own identity and `getUID()` in `pp.js`. |
| `addUserToGroup`, `removeUserFromGroup`, `changeNickname`, `setTitle` | `groups` | Native AppState-backed web actions with synthetic tests; live acceptance is unverified. |
| `createNewGroup` | `groups` | Native authenticated GraphQL group-create mutation with participant validation and normalized thread ID; synthetic request/response test added. Live acceptance is unverified. |
| `changeAdminStatus`, `createPoll` | `groups` | Native authenticated group-admin and poll actions with input validation and synthetic tests; live acceptance is unverified. |
| `handleMessageRequest`, `searchForThread`, `getThreadPictures` | `threads` | Native message-request routing, thread search and shared-photo retrieval with response validation and synthetic tests; live acceptance is unverified. |
| `changeBlockedStatus`, `changeBio`, `unfriend`, `getEmojiUrl` | `users` / utility | Native account/profile actions and local emoji URL helper with declarations and synthetic tests; live acceptance is unverified. |
| `setMessageReaction` | `reactions` | Native AppState-backed web action with synthetic tests; live acceptance is unverified. |
| `changeThreadColor`, `changeThreadEmoji` | `threads` | Native AppState-backed customization endpoints with synthetic tests; live acceptance is unverified. |

## Complete GoatBot call-site audit

The complete static scan covers all 271 JavaScript files and 28 Eta templates in the reviewed `fca-migration-cleanup` tree. It includes login/lifecycle, commands, events, database, dashboard and custom helpers. The full method-to-file map, event contract, option audit, exact signature mismatches and security findings are recorded in [GOATBOT-CALLSITE-INVENTORY.md](GOATBOT-CALLSITE-INVENTORY.md).

Confirmed direct calls include `getAppState`, `getCookies`, `refreshFb_dtsg`, `getHumanizer`, `setOptions`, `getCurrentUserID`, `getThreadList`, `getThreadInfo`, `getThreadHistory`, `getUserInfo`, `getUID`, `sendMessage`, `editMessage`, `unsendMessage`, `setMessageReaction`, `markAsRead`, `markAsReadAll`, `markAsSeen`, `markAsDelivered`, `deleteMessage`, `deleteThread`, `muteThread`, `changeArchivedStatus`, `shareContact`, `addUserToGroup`, `removeUserFromGroup`, `changeNickname`, `changeGroupImage`, `changeAvatar`, `setTitle`, `changeThreadColor` and `changeThreadEmoji`.

The call-site compatibility fixes are now present in FCA-2 `main` (candidate `0.1.6-rc.3`): `getThreadList` accepts the legacy limit/tags forms and pages requests up to a bounded 10,000-thread ceiling; `getThreadHistory` pages up to 1,000 messages; the public `sendMessage` facade accepts the legacy third-position reply ID; and normalized events expose `read_receipt` actor aliases plus nested `messageReply` metadata when supplied by the incoming delta. The native attachment pipeline accepts Buffer, Uint8Array, Blob and Node readable streams, uploads before send, and rejects incomplete upload/send responses. Synthetic regression coverage includes pagination above one page, reply/read normalization, and attachment upload/send; a stream-backed attachment regression is included in the current prerelease CI batch. These source-level compatibility fixes are not available to GoatBot until the candidate is published and its dependency/lockfile are updated. All private Facebook endpoint behavior remains subject to authorized live acceptance.

## Required work before migration

- Complete live validation of the owner-supplied AppState session; username/password and 2FA login remain deferred, and checkpoint resolution remains manual.
- Source-level thread-list/history pagination, positional reply-ID handling, attachment streams, and event shape adapters are implemented in the `0.1.6-rc.3` candidate. Publish the prerelease and update GoatBot's dependency/lockfile to that exact published version before validating integration against the packaged artifact.
- Keep unsupported or unverified legacy methods explicit; do not return dummy success responses. Group E2EE Sender Keys, Labyrinth backup/restore, and E2EE calls remain unimplemented.
- Validate native MQTT frame decoding, event normalization, readiness, reconnect and deterministic shutdown against an authorized account; synthetic fake-broker coverage is not live acceptance.
- Run the owner-operated `npm run test:messenger-mqtt` check for live readiness and inbound events; use its explicit opt-in send mode only against a thread the owner controls and verify recipient delivery.
- After the owner publishes the `next` prerelease, pin that exact published version in GoatBot `fca-migration-cleanup`, regenerate `package-lock.json`, then run secure-session, FCA integration, syntax, startup and contract tests.
- Verify CI on the latest prerelease head; keep username/password login deferred and preserve all existing Bot credentials/configuration. Live AppState acceptance remains a separate owner-operated gate.

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


## E2EE support (2026-11-21)

| API / behavior | Status | Notes |
|---|---|---|
| `connectE2EE`, `_connectE2EEAndMerge` | Implemented in driver | Separate Noise E2EE socket, device registration and prekey sync; live Meta acceptance pending. |
| `sendE2EEMessage`, `sendMessage(..., { e2ee: "required" })` | Implemented for one-to-one path | Per-device Signal-style sessions; explicit required mode fails closed and does not fall back to plaintext. |
| E2EE media send/download | Implemented for one-to-one path | Encrypted media, ciphertext hash and HMAC verification; live upload/download acceptance pending. |
| E2EE incoming events | Implemented in listener integration | Message, edit, reaction and revoke events merge into `listen`/`listenMqtt`. |
| Persistent device state | Implemented | AES-256-GCM encrypted file; explicit 32-byte key required for persistent storage. |
| Group Sender Keys/SKDM, Labyrinth backup, E2EE calls | Not implemented | Not advertised as supported. |
