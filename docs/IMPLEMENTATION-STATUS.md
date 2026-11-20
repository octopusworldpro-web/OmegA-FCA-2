# OmegA-FCA implementation status

## Implemented in the current branch

- Node.js 20+ CommonJS package, root exports and TypeScript declarations.
- Cookie/AppState parsing and validation, encrypted session helpers, restrictive file permissions and secret redaction.
- **New encrypted SessionGuard utility and native-driver integration:** when configured with an explicit owner-managed 32-byte/64-hex key and a private file path, the native MQTT driver immediately snapshots the validated account AppState after realtime connection, periodically saves encrypted snapshots, preserves a verified backup, and performs a final save during shutdown. A corrupted primary can be restored from a valid encrypted backup. It never generates or stores encryption keys; persistence remains opt-in so deployments must supply the key securely.
- **Updated:** account configuration is AppState-only for this phase. `account.txt` accepts cookie/AppState data only and rejects credential-like key/value text. The loader does not read email, username, password, 2FA, or `FB_*` environment credentials; credential login is deferred.
- **New AppState test entry point:** `npm run test:appstate` validates an owner-supplied AppState from `account.txt` (or the documented `appstate.json` fallback), reports only non-secret session metadata, and is deliberately excluded from CI because it requires a real authorized session and network access.
- **New native personal-session foundation:** `createPersonalSession()` validates an owner-supplied AppState against Facebook over HTTPS, scopes session cookies to Facebook/Messenger hosts, provides bounded-time authenticated web requests, and reports expired sessions/checkpoints without bypassing them.
- Bounded HTTPS request helper and secure cookie jar.
- **New safe diagnostics utility:** bounded metadata-only recorder, integrated with AppState-backed personal-session requests; excludes header/query/body/response values and credential material.
- **New authenticated Facebook web client:** `createFacebookWebClient()` adds token-aware POST form serialization, GET/HEAD/POST handling, strict Facebook/Messenger HTTPS host validation, manual redirect classification (checkpoint/expired/unexpected), normalized JSON/error responses, and 2 MiB inbound/outbound body limits. It intentionally does not invent private action endpoints or payload schemas.
- Connection supervisor with bounded reconnect/backoff, listener recovery and abortable connect attempts.
- Event dispatcher with duplicate coalescing, success-only acknowledgement and per-thread ordering.
- Injectable transport contract and GoatBot callback-login adapter. The public client login facade accepts AppState/cookie modes and an explicit encrypted-SessionGuard restore mode; username/email-password login is explicitly rejected until a safe native provider is implemented.
- **New protocol-neutral native WebSocket runtime:** bounded connect/close waits, abort-aware connection setup, protocol-adapter hooks for authentication/subscription/frame decoding/action encoding, bounded frame handling, listener lifecycle, diagnostics metadata, and deterministic fake-socket tests. This is transport infrastructure only; it does not include Facebook's private handshake, endpoint, subscription topics, or action schemas.
- **New Facebook web realtime gateway adapter:** `createFacebookGatewayProtocol()` builds the `gateway.facebook.com/ws/realtime` upgrade URL and owner-cookie headers, sends the numbered subscription frames used by public FCA implementations, and decodes notification/presence gateway payloads. This is a separate web notification/presence channel; it is not the Messenger private message-sync channel and does not claim send-message support. The endpoint/subscription family is unofficial and may change server-side.
- **New MQTT 3.1/3.1.1 codec and stream primitives:** CONNECT, PUBLISH, SUBSCRIBE, UNSUBSCRIBE, packet acknowledgements, PINGREQ and DISCONNECT encoding plus bounded packet decoding. Includes legacy `MQIsdp` protocol version 3 support used by public FCA implementations.
- **New Facebook Messenger MQTT adapter:** observed `edge-chat.facebook.com/chat` URL construction, cookie/Origin headers, MQTT 3.1 CONNECT metadata, CONNACK validation, topic subscription, `/messenger_sync_create_queue` or `/messenger_sync_get_diffs` bootstrap, QoS 1 acknowledgement, publish actions and keepalive PINGREQ. This is an experimental native transport layer. It includes conservative known-shape `/t_ms` delta normalization, encrypted account-bound sync cursor storage with reconnect reload, bounded `/ls_req`–`/ls_resp` correlation, and an observed text/sticker/reply task builder exposed as `sendMessage`. Task schemas and broker acceptance remain unverified against a live account; this is not yet a drop-in FCA replacement.
- **New research register (2026-11-20):** separates Meta's historical MQTT/snapshot-delta architecture statements, OASIS MQTT 3.1.1 normative transport rules, and unofficial FCA source observations from current Facebook-specific facts.
- **New:** `createLegacyFcaProvider()` bridges an existing callback-style personal-account FCA implementation into OmegA-FCA's transport contract. It maps AppState or credentials login, manual 2FA inputs, current-user lookup, MQTT listener lifecycle and supported FCA methods.
- Checkpoint and expired-session classification. The owner must resolve Facebook challenges through Facebook. Native username/email-password login and owner-mediated 2FA continuation remain deferred and rejected by the current public client login facade; no credential login is claimed by this branch.
- Provider-neutral authentication-attempt coordinator with bounded challenge rounds, single-use continuation, optional provider cleanup on cancellation, and secret-safe public snapshots. This is lifecycle plumbing only; no Facebook credential provider is included.
- Optional Ed25519 licensing and signed update-manifest verification.
- Separate official Meta Messenger Page transport and webhook example.

## Public-FCA-style web action layer

- Added AppState-session-backed `getThreadList`, `getThreadInfo`, `getThreadHistory`, and `getUserInfo` adapters using the legacy public FCA GraphQL-batch and `/chat/user_info/` conventions, with normalized responses, validation, pagination, and Promise/callback forms.
- Added `addUserToGroup`, `removeUserFromGroup`, `changeNickname`, `setMessageReaction`, and `markAsRead` using public FCA request patterns. Wired into the first-party MQTT driver.
- Synthetic request/response tests cover these adapters. Facebook private endpoints and document IDs are unofficial and may change; live account acceptance remains unverified. `createNewGroup` is intentionally not exposed until its request contract is evidenced.

## Not yet implemented — standalone personal FCA blockers

This package is **not yet a standalone, drop-in personal-account FCA replacement**.

- OmegA-FCA does not yet implement the full personal-account authentication flow (username/password + 2FA), complete Facebook private HTTP/GraphQL action catalog or endpoint-specific payload schemas. The new AppState session bootstrap and generic authenticated web-client layer are session/request foundations only; they do not constitute the FCA action API. Username/password login is not yet implemented natively; the username field is currently an input contract for the future auth provider.
- The Facebook web realtime notification/presence gateway adapter is implemented separately from Messenger MQTT.
- The Messenger MQTT adapter now implements observed connection/queue bootstrap, conservative delta normalization, optional encrypted cursor persistence/reload, bounded request correlation, and an experimental message-send task builder. Cursor persistence requires the caller to explicitly configure `syncCursorStore`. It does not yet guarantee missed-event recovery or broker compatibility against a live account.
- The Messenger MQTT adapter now has an integrated `createFacebookMqttDriver()` path and a first-party `createFacebookMqttClient()` factory. The factory wires AppState validation, cookie scoping, native WebSocket/MQTT handshake, connection supervision, identity lookup, callback-compatible `listenMqtt`, legacy callback and Promise `sendMessage` signatures, `getUserID` alias, correlated requests and the experimental message-send method. The package now supplies its own `ws` WebSocket implementation by default (injection remains available for tests). This wiring is covered by deterministic fake-broker tests, not a real Facebook account. Public FCA wire observations are not an officially supported Meta personal-account API; endpoint, metadata, topics, delta mappings and task schemas still require live authorized-account verification.
- Full parity with every legacy FCA method, event shape, and GoatBot call site has not been proven.
- No authorized live personal-account end-to-end test has been run from this repository. The new AppState smoke-test command is prepared but has not yet been run against a real account.
- The GoatBot `fca-migration-cleanup` branch has now been switched to the first-party `createFacebookMqttClient()` path and no longer declares `@eryxenx/fca`. The callback login adapter now receives a native-ready event after AppState validation, MQTT CONNACK, and topic subscription. This is code-level integration only; full FCA method parity and a real authorized account test remain outstanding.

The personal-account MQTT adapter is experimental and based on public FCA wire observations, not an officially supported Meta personal-account API. The Page transport is separate and is not a substitute for a personal account.

## Verification gate

Synthetic AppState session, authenticated web-client, redirect-classification, body-limit and adapter tests have been added. GitHub Actions must run on the latest branch commit before claiming the test suite passes. A real authorized account test is still required for login, MQTT readiness, message receive/send, group actions, reconnect, and checkpoint/session-expiry reporting.

Never commit live cookies, AppState, passwords, 2FA material, Page tokens, or encryption keys. Do not bypass checkpoints or platform security controls.
