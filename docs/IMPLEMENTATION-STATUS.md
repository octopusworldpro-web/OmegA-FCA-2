# OmegA-FCA implementation status

## Implemented in the current branch

- Node.js 20+ CommonJS package, root exports and TypeScript declarations.
- Cookie/AppState parsing and validation, encrypted session helpers, restrictive file permissions and secret redaction.
- **New encrypted SessionGuard integration:** explicit-key AES-256-GCM snapshots, verified backup recovery, periodic saves, final save on shutdown, account-ID verification on restore, and GoatBot's legacy `sessionGuard(account.txt, options)` call supported as a non-destructive alias for a separately configured encrypted file. `FCA_SESSION_FILE`, `FCA_SESSION_KEY`, and `FCA_SESSION_INTERVAL_MS` are optional deployment variables; the encrypted file and backup are rejected if they resolve to the Bot's root `account.txt`, `appstate.json`, or `config.json`.
- **Updated:** account configuration is AppState-only for this phase. `account.txt` accepts cookie/AppState data only and rejects credential-like key/value text. The loader does not read email, username, password, 2FA, or `FB_*` environment credentials; credential login is deferred.
- **New AppState test entry point:** `npm run test:appstate` validates an owner-supplied AppState from `account.txt` (or the documented `appstate.json` fallback), reports only non-secret session metadata, and is deliberately excluded from CI because it requires a real authorized session and network access.
- **New owner-operated MQTT acceptance command:** `npm run test:messenger-mqtt` loads the local AppState, attempts native MQTT readiness, and logs only event types. Sending is opt-in and requires `--send` plus explicit `FCA_TEST_THREAD_ID` and `FCA_TEST_MESSAGE` values. This live check is excluded from CI; client publish acceptance is not proof of recipient delivery.
- **New native personal-session foundation:** `createPersonalSession()` validates an owner-supplied AppState against Facebook over HTTPS, scopes session cookies to Facebook/Messenger hosts, provides bounded-time authenticated web requests, and reports expired sessions/checkpoints without bypassing them.
- Bounded HTTPS request helper and secure cookie jar.
- **New safe diagnostics utility:** bounded metadata-only recorder, integrated with AppState-backed personal-session requests; excludes header/query/body/response values and credential material.
- **New authenticated Facebook web client:** `createFacebookWebClient()` adds token-aware POST form serialization, GET/HEAD/POST handling, strict Facebook/Messenger HTTPS host validation, manual redirect classification (checkpoint/expired/unexpected), normalized JSON/error responses, and 2 MiB inbound/outbound body limits. It intentionally does not invent private action endpoints or payload schemas.
- Connection supervisor with bounded reconnect/backoff, listener recovery and abortable connect attempts.
- Event dispatcher with duplicate coalescing, success-only acknowledgement and per-thread ordering.
- Injectable transport contract and GoatBot callback-login adapter. The public client login facade accepts AppState/cookie and explicit encrypted SessionGuard restore modes; username/email-password login remains deferred and is explicitly rejected.
- **New protocol-neutral native WebSocket runtime:** bounded connect/close waits, abort-aware connection setup, protocol-adapter hooks for authentication/subscription/frame decoding/action encoding, bounded frame handling, listener lifecycle, diagnostics metadata, and deterministic fake-socket tests. This is transport infrastructure only; it does not include Facebook's private handshake, endpoint, subscription topics, or action schemas.
- **New Facebook web realtime gateway adapter:** `createFacebookGatewayProtocol()` builds the `gateway.facebook.com/ws/realtime` upgrade URL and owner-cookie headers, sends the numbered subscription frames used by public FCA implementations, and decodes notification/presence gateway payloads. This is a separate web notification/presence channel; it is not the Messenger private message-sync channel and does not claim send-message support. The endpoint/subscription family is unofficial and may change server-side.
- **New MQTT 3.1/3.1.1 codec and stream primitives:** CONNECT, PUBLISH, SUBSCRIBE, UNSUBSCRIBE, packet acknowledgements, PINGREQ and DISCONNECT encoding plus bounded packet decoding. Includes legacy `MQIsdp` protocol version 3 support used by public FCA implementations.
- **New Facebook Messenger MQTT adapter:** observed `edge-chat.facebook.com/chat` URL construction, cookie/Origin headers, MQTT 3.1 CONNECT metadata, CONNACK validation, topic subscription, `/messenger_sync_create_queue` or `/messenger_sync_get_diffs` bootstrap, QoS 1 acknowledgement, publish actions and keepalive PINGREQ. This is an experimental native transport layer. It includes conservative known-shape `/t_ms` delta normalization, encrypted account-bound sync cursor storage with reconnect reload, bounded `/ls_req`–`/ls_resp` correlation, and an observed text/sticker/reply task builder exposed as `sendMessage`. Task schemas and broker acceptance remain unverified against a live account; this is not yet a drop-in FCA replacement.
- **New research register (2026-11-20):** separates Meta's historical MQTT/snapshot-delta architecture statements, OASIS MQTT 3.1.1 normative transport rules, and unofficial FCA source observations from current Facebook-specific facts.
- **New:** `createLegacyFcaProvider()` bridges an existing callback-style personal-account FCA implementation into OmegA-FCA's transport contract. It maps AppState or credentials login, manual 2FA inputs, current-user lookup, MQTT listener lifecycle and supported FCA methods.
- Checkpoint and expired-session classification. The owner must resolve Facebook challenges through Facebook. Credential/2FA login is deferred and rejected by the current public client login facade.
- Provider-neutral authentication-attempt coordinator with bounded challenge rounds, single-use continuation, optional provider cleanup on cancellation, and secret-safe public snapshots. This is lifecycle plumbing only; no Facebook credential provider is included.
- Optional Ed25519 licensing and signed update-manifest verification.
- Separate official Meta Messenger Page transport and webhook example.

## Public-FCA-style web action layer

- Added AppState-session-backed `getThreadList`, `getThreadInfo`, `getThreadHistory`, and `getUserInfo` adapters using the legacy public FCA GraphQL-batch and `/chat/user_info/` conventions, with normalized responses, validation, pagination, and Promise/callback forms.
- Added `addUserToGroup`, `removeUserFromGroup`, `changeNickname`, `setMessageReaction`, `markAsRead`, `markAsDelivered`, `sendTypingIndicator`, `createNewGroup`, `changeGroupImage`, and `changeAvatar` using observed public FCA request patterns. Wired into the first-party MQTT driver.
- Added bounded image input handling with JPEG/PNG/GIF/WebP signature detection and 10 MiB cap; group/profile image uploads validate returned IDs before applying changes. Generic message-attachment transfer remains unsupported.
- Added authenticated `httpGet` and `httpPost` helpers with Promise and legacy error-first callback signatures. `httpGet` is exposed through the client facade and declared in TypeScript.
- Synthetic request/response tests cover these adapters. Facebook private endpoints and document IDs are unofficial and may change; live account acceptance remains unverified.

## Not yet implemented — standalone personal FCA blockers

This package is **not yet a standalone, drop-in personal-account FCA replacement**.

- OmegA-FCA does not yet implement the full personal-account authentication flow (username/password + 2FA), complete Facebook private HTTP/GraphQL action catalog or endpoint-specific payload schemas. The new AppState session bootstrap and generic authenticated web-client layer are session/request foundations only; they do not constitute the FCA action API. Username/password login is not yet implemented natively; the username field is currently an input contract for the future auth provider.
- The Facebook web realtime notification/presence gateway adapter is implemented separately from Messenger MQTT.
- The Messenger MQTT adapter now implements observed connection/queue bootstrap, conservative delta normalization, optional encrypted cursor persistence/reload, bounded request correlation, and an experimental message-send task builder. Cursor persistence requires the caller to explicitly configure `syncCursorStore`. It does not yet guarantee missed-event recovery or broker compatibility against a live account.
- The Messenger MQTT adapter now has an integrated `createFacebookMqttDriver()` path and a first-party `createFacebookMqttClient()` factory. The factory wires AppState validation, cookie scoping, native WebSocket/MQTT handshake, connection supervision, identity lookup, callback-compatible `listenMqtt`, legacy callback and Promise `sendMessage` signatures, `getUserID` alias, correlated requests and the experimental message-send method. The package now supplies its own `ws` WebSocket implementation by default (injection remains available for tests). This wiring is covered by deterministic fake-broker tests, not a real Facebook account. Public FCA wire observations are not an officially supported Meta personal-account API; endpoint, metadata, topics, delta mappings and task schemas still require live authorized-account verification.
- Full parity with every legacy FCA method, event shape, and GoatBot call site has not been proven.
- Encrypted SessionGuard is now implemented and covered by synthetic unit/integration tests, but real Facebook session renewal, long-duration persistence, and restore after Facebook-side expiry still require authorized live-account testing.
- No authorized live personal-account end-to-end test has been run from this repository. The new AppState smoke-test command is prepared but has not yet been run against a real account.
- The GoatBot `fca-migration-cleanup` branch has now been switched to the first-party `createFacebookMqttClient()` path and no longer declares `@eryxenx/fca`. The callback login adapter now receives a native-ready event after AppState validation, MQTT CONNACK, and topic subscription. This is code-level integration only; full FCA method parity and a real authorized account test remain outstanding.

The personal-account MQTT adapter is experimental and based on public FCA wire observations, not an officially supported Meta personal-account API. The Page transport is separate and is not a substitute for a personal account.

## Verification gate

Synthetic AppState session, authenticated web-client, redirect-classification, body-limit and adapter tests have been added. GitHub Actions must run on the latest branch commit before claiming the test suite passes. A real authorized account test is still required for login, MQTT readiness, message receive/send, group actions, reconnect, and checkpoint/session-expiry reporting.

Never commit live cookies, AppState, passwords, 2FA material, Page tokens, or encryption keys. Do not bypass checkpoints or platform security controls.


## Latest verification update — 2026-11-21

- MQTT keepalive is now a single validated CONNECT setting; PINGREQ is scheduled at half the negotiated interval, and zero disables the periodic ping. Regression tests cover the default and explicit values.
- Eryxen public API coverage and security comparison is documented in `docs/ERYXEN-REFERENCE-AUDIT.md`; the audit is included in the npm package file allowlist.
- README now correctly states that the package supplies its own `ws` implementation by default; injection remains available for tests.
- GitHub Actions run `44842962868` passed on Node.js 20 and 22 for the exact same source tree as this prerelease head: `npm ci`, all 302 tests (302 passed, 0 failed), syntax checks, package root export smoke test, and `npm pack --dry-run`.
- This is synthetic CI verification only. No live authorized Facebook account, broker acceptance, recipient-confirmed delivery, or full FCA parity is claimed.


## GoatBot login-option compatibility update — 2026-11-21

- Fixed login-option forwarding: `createFacebookMqttClient()` now passes the options supplied by `createGoatBotLogin()` into the first-party native driver.
- Native event filters now honor `selfListen`, `selfListenEvent`, `listenEvents`, `listenTyping`, and `updatePresence`; `autoMarkDelivery` and `autoMarkRead` are opt-in receipt actions.
- Supported runtime options can be changed through `setOptions()`; unsupported options are rejected explicitly. `userAgent` is forwarded to the native HTTP/MQTT session. Proxy login is explicitly unsupported.
- Deterministic tests cover event filtering, runtime option updates, and the login adapter forwarding options. GitHub Actions run #135 (`44843369568`) passed on Node.js 20 and 22: 304 tests passed, 0 failed; syntax checks, package exports and `npm pack --dry-run` also passed.


## Additional thread API coverage — 2026-11-21

- Added native `getMessage(threadID, messageID, callback?)`, implemented through the authenticated thread-history adapter and normalized message format.
- The lookup currently searches the latest 100 messages returned for that thread; it returns `null` when the target is not in that page. This is not yet an unbounded historical search.
- Added synthetic tests for found, missing and invalid message IDs. The next CI run must validate this addition before it is considered green.


## GoatBot credential-access compatibility — 2026-11-21

- Added `getCookies()` to the native driver and client facade. It returns the authenticated Facebook cookie header required by GoatBot's existing `suspend` command.
- The cookie header is credential material: never log it, include it in diagnostics, or expose it to ordinary users. The method is documented as sensitive alongside `getAppState()`.
- Added TypeScript declarations and regression tests for driver and client-facade access. A fresh Node 20/22 CI run is required for this change.


## Additional Messenger action compatibility — 2026-11-21

- Added `editMessage(text, messageID, callback?)` using the observed Messenger Lightspeed `edit_message` task and correlated `/ls_resp` response parsing. It rejects malformed responses and reports old/non-owned message rejection rather than claiming success.
- Added `shareContact(text, senderID, threadID, callback?)` using the observed `messenger_contact_sharing` task. The legacy fourth string argument used by GoatBot is accepted as a compatibility placeholder.
- Added client-facade method registration, TypeScript declarations, and deterministic fake-broker tests for both request/response flows.
- GitHub Actions verification is pending for these latest action additions and the sensitive `getCookies()` method.


## User and group lookup coverage — 2026-11-21

- Added authenticated typeahead `getUserID(name)` and `getUID(profile)` resolution for numeric IDs, profile.php IDs, /people URLs, and vanity names.
- Added authenticated `resolvePhotoUrl(photoID)` with HTTPS Facebook CDN host validation.
- Added normalized `getFriendsList()` and the observed GraphQL `createNewGroup(participantIDs, title?)` mutation.
- Added client method registration and TypeScript declarations, plus synthetic request/response tests for each path.
- These Facebook-private endpoints remain unofficial and need authorized live-account acceptance. CI must validate this batch before it is considered green.


## GoatBot humanizer middleware — 2026-11-21

- Added native `getHumanizer()`, created when `listenMqtt()` starts, matching GoatBot's `humanizerOptions.js` lifecycle.
- Implemented `enabled`, fixed or ranged `reactDelayMs`, per-thread/global `cooldownMs`, `maxPerMinute`, and `perThread` behaviour.
- The middleware starts a typing indicator, holds the incoming message for the configured reaction delay, then stops typing and delivers the event. It skips self messages (unless the Bot's self-listen filter allows them) and E2EE-marked events.
- Pending typing timers are stopped when the listener detaches, errors, or the client disconnects.
- Added unit tests and driver lifecycle tests. CI must verify this latest change before it is considered green.


## Client facade compatibility verification — 2026-11-21

- Added a regression test proving native `httpGet` is forwarded through the public client facade in both Promise/query and legacy callback signatures.
- This is a deterministic adapter test only; the authenticated Facebook GET endpoint still requires owner-operated live AppState verification.


## Serial workflow checkpoint — Step 2 complete (2026-11-21)

- The primary current comparison target is `@eryxenx/fca@1.3.5` (public npm README), not only the separately named historical `fca-eryxenx` quick-reference package.
- A method-by-method source audit is recorded in [ERYXEN-API-PARITY-MATRIX.md](ERYXEN-API-PARITY-MATRIX.md). It distinguishes implemented source paths, adapters, partial semantics, missing methods and live-unverified behavior.
- Remaining public API gap recorded for later implementation: `uploadImageToImgbb` (not substituted with a different upload host). Step 8 has since added the distinct E2EE listener and one-to-one reaction/typing/unsend/edit controls; E2EE mark-read and group Sender Keys remain unsupported.
- Step 2 is an audit/documentation gate only. It does not claim those missing methods are implemented or that Facebook live-account acceptance has passed.


## Serial workflow checkpoint — Step 4 complete (2026-11-21)

- Hardened `ConnectionSupervisor` retry policy validation: bounded attempts, delays, exponential factor and jitter are validated before connecting.
- Reconnect backoff now accepts cancellation; `stop()` aborts a pending delay immediately instead of waiting for the full retry timer.
- `stop()` now waits for an in-flight listener-recovery cleanup before reporting the supervisor as stopped, preventing shutdown from racing an old driver's disposal.
- MQTT keepalive is validated as an integer from 0 to 65,535 seconds. PINGREQ is sent at half the negotiated interval; a matching PINGRESP clears the outstanding heartbeat, and a missing response closes the stale socket so the supervisor can reconnect. A keepalive value of zero disables heartbeat traffic.
- Added regression tests for aborting reconnect backoff, waiting for recovery disposal, invalid retry policies, PINGRESP handling, missing-response socket closure, and keepalive bounds.
- GitHub Actions run #306 (`44877756730`) passed on Node.js 20 and 22: 376 tests passed, 0 failed on each runtime; syntax checks, package root export smoke test, and publishable package verification also passed.
- This is synthetic transport/CI verification. No authorized live Facebook account or production broker acceptance test has been run; live reconnect and event delivery remain an owner-operated acceptance gate.


## Serial workflow checkpoint — Step 5 complete (2026-11-21)

- Text, sticker, reply and attachment sends retain their separate native paths. MQTT text/reply sends await the correlated `/ls_resp`; explicit Facebook rejection payloads now raise `FCA_FACEBOOK_REQUEST_REJECTED` instead of being returned as apparent success.
- `shareContact` now uses the same bounded request/response correlation rather than fire-and-forget publishing, and returns the broker response payload instead of fabricating `{ success: true }` after a socket write.
- `editMessage` remains request-correlated, validates the returned message ID/body, and rejects old or non-owned messages with `FCA_MESSAGE_EDIT_REJECTED`. `unsendMessage` uses the authenticated unsend endpoint with explicit rejection handling.
- Read, read-all, seen and delivery receipts have focused request-shape, validation and callback tests. Read-receipt event normalization now preserves `watermarkTimestamp` from message metadata as well as top-level delta fields.
- Hardened concurrent MQTT request tracking: a failed publish rejects only its own request, saturated/invalid requests are rejected before any packet is published, and request-ID wraparound skips IDs that are still pending.
- Added regression coverage for reply metadata/correlation, send rejection, edit rejection, share-contact response correlation, unsend/read/seen/delivery receipts, read watermark metadata, concurrent request isolation and request-ID wraparound. Updated public TypeScript signatures for edit, unsend and receipt methods.
- GitHub Actions run #325 (`44878685676`) passed on Node.js 20 and 22: 384 tests passed, 0 failed on each runtime; syntax checks, package root export smoke test, and publishable package verification passed.
- This is synthetic CI verification only. No authorized live Facebook account, recipient-confirmed message delivery, edit/unsend acceptance, or production receipt acceptance has been run; those remain owner-operated live acceptance checks.


## Group, thread and user API progress — 2026-11-21

- Audited the existing first-party thread adapter, public client facade, TypeScript declarations, and Eryxen parity matrix before adding code. Existing coverage already includes bounded thread list/history pagination, thread/profile lookup, group creation and membership, nicknames, admin status, polls, thread customization, friend-list lookup, friend-request decisions, block/unfriend actions, and read/seen/delivery receipts.
- Added a validated Lightspeed pin/unpin task builder using the observed labels 430/431 and queue names `pin_msg_v2_<threadID>` / `unpin_msg_v2_<threadID>`. Exposed `pinMessage(messageID, threadID)` and `unpinMessage(messageID, threadID)` on the native driver and client facade, added TypeScript declarations, root export for the request builder, and deterministic payload tests. Added native Comet mutations for `sendFriendRequest`, `followUser`, `unfollowUser`, text-only `postComment`, and `sharePost` (feed-to-feed reshare), with error normalization and deterministic request/response tests. The namespaced client exposes thread pin/unpin aliases and a `posts` namespace for social actions. Fixed the CI-discovered regex escaping, namespace source escaping, and synchronous validation test expectation.
- Pin/unpin task shape is community-observed and is not claimed live-verified. The remaining parity gaps from the current audit include `sendFriendRequest`, `followUser`, `unfollowUser`, `postComment`, and `sharePost`; these must not be reported as complete until implemented and tested. Avoid speculative endpoint substitutions.
- A fresh Node 20/22 CI run is required for this corrected implementation batch before code verification is considered green. No authorized live Facebook acceptance has been run; all private Comet/Lightspeed endpoints remain live-unverified.


## Step 8 — E2EE & Advanced Compatibility checkpoint (2026-11-21)

- [x] Dedicated E2EE-only listener exposed as `listenE2EE` and `api.e2ee.listen()`.
- [x] One-to-one E2EE reaction add/remove, edit, unsend and typing start/stop operations added to the Noise/Signal encrypted path.
- [x] Operations reject unknown/group threads instead of falling back to plaintext or pretending group Sender Keys exist.
- [x] Public facade, namespaced E2EE API, TypeScript declarations and usage docs updated.
- [x] Synthetic payload/frame tests added for E2EE control operations; existing crypto, media integrity, storage encryption and cookie-isolation tests retained.
- [ ] E2EE mark-read, group Sender Keys/group media, Labyrinth backup/restore and key-transparency verification remain outside the current implementation.
- [ ] Authorized live Facebook account acceptance (device registration, Noise handshake, reaction/edit/unsend/typing send/receive) remains required before production claims.

**Status:** Core one-to-one E2EE compatibility implementation is in place. This is not a claim of full Messenger E2EE support; group encryption and encrypted backup/key-transparency capabilities remain explicit gaps.
