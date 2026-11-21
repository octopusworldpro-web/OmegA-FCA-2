# Eryxen FCA reference audit and OmegA-FCA parity plan

**Reference:** `@eryxenx/fca` public npm API reference, reviewed 2026-11-21  
**Implementation target:** OmegA-FCA native CommonJS client  
**Rule:** use the public API surface and observable behaviour as a compatibility checklist; do not import Eryxen code, runtime dependencies, private credentials, or undocumented endpoint payloads.

## Security boundary

OmegA-FCA must not depend on `@eryxenx/fca` at runtime. The reference package is for API-surface comparison only. OSV advisory [MAL-2026-20276](https://osv.dev/vulnerability/MAL-2026-20276) reports that versions 1.3.0–1.3.2 send supplied Facebook email/password and a 2FA Base32 secret to a third-party login endpoint. Never pass credentials, TOTP seeds, cookies, or AppState to those affected package versions. This is a reason to maintain an independent implementation and audit every outbound host.

## API parity inventory

Status labels:
- **Implemented (synthetic-tested):** first-party code and deterministic tests exist; live Facebook acceptance is not implied.
- **Experimental:** a first-party shape exists, but protocol/payload or recipient delivery is not verified against an authorized live account.
- **Deferred:** deliberately not implemented in this phase.
- **Missing:** no first-party implementation currently exists.
- **Facade/conditional:** exposed only when a driver provides it; not a claim of native support.

| Reference API area | Reference methods / behaviours | OmegA-FCA status |
|---|---|---|
| Login and account | AppState login, current-user ID, AppState export, token refresh, logout, options | AppState/cookie login, current identity, AppState export and token refresh are implemented at the native facade; native username/password + 2FA is deferred; GoatBot's core listener options and selected setOptions runtime flags are supported, while full option parity and logout semantics still need audit |
| GoatBot session compatibility | getCookies | Sensitive cookie-header accessor required by the current `suspend` command; implemented natively and must remain owner-only in command exposure. |
| Session recovery | sessionGuard, saveSession, restoreSessionBackup, stopSessionGuard | Encrypted AES-256-GCM sidecar, verified backup recovery, periodic/final save and account-bound restore are implemented and synthetic-tested; legacy account.txt is never overwritten |
| Realtime | MQTT connect, listenMqtt, ready, error, auto-reconnect, event subscriptions | Native WebSocket/MQTT driver, supervisor and callback facade are implemented; live broker and event parity remain unverified |
| Messages | sendMessage, editMessage, unsendMessage, deleteMessage, getMessage, broadcast | sendMessage is experimental; unsendMessage is implemented with synthetic web-action tests; delete/broadcast are missing or not verified; `editMessage` and `shareContact` now have native MQTT request builders with synthetic response tests; `getMessage` is implemented as a lookup in the latest 100 normalized thread-history messages |
| Attachments and media | uploadAttachment, forwardAttachment, sendImage, sendVideo, sendAudio, sendFile, sendGif, sendLocation, shareLink, shareContact | Full upload/download and attachment event parity are missing; do not return dummy success |
| Reactions and receipts | setMessageReaction, markAsRead, markAsReadAll, markAsDelivered, markAsSeen, typing | setMessageReaction, markAsRead, markAsDelivered and sendTypingIndicator have first-party synthetic-tested paths; markAsReadAll/markAsSeen need audit |
| Threads | getThreadList, getThreadInfo, getThreadHistory, getMessage, createGroup, deleteThread, muteThread, archive, request handling, search | list/info/history, latest-100 `getMessage`, typeahead `getUserID`, `getFriendsList`, `getUID`, `resolvePhotoUrl`, and selected group operations now have synthetic-tested adapters; createNewGroup is withheld pending evidenced request contract; other thread operations need audit |
| Thread customization | setTitle, changeThreadColor, changeThreadEmoji, changeNickname, changeGroupImage, changeAdminStatus, polls, pin/unpin | title/color/emoji/nickname and add/remove member paths have synthetic-tested adapters; image/admin/poll/pin operations are missing or unverified |
| Users and social | getUserInfo, getUID, getFriendsList, avatar/profile/public data, friend/block/follow actions, post/comment/share/reactions | getUserInfo is implemented with synthetic tests; other methods are missing or require an evidence-backed contract |
| HTTP helpers | httpGet, httpPost, multipart form data | bounded authenticated Facebook/Messenger HTTPS web client and httpPost facade exist; GET/multipart upload parity needs audit |
| Higher-level helpers | namespaced client, MessengerBot, sendBroadcast, humanizer | not part of the minimum FCA compatibility layer yet; assess after flat API and event parity |

## Implementation order

1. Keep the Node 20/22 CI matrix green and retain deterministic tests for MQTT CONNECT/CONNACK, SUBACK, keepalive cadence, cursor recovery, listener teardown and reconnect.
2. Complete a repository-wide GoatBot call-site inventory (commands, events, dashboard, database, custom scripts and dynamic calls); classify every method and event shape as required, optional, or unused.
3. Implement only methods whose transport and request/response contract can be evidenced. For unknown private GraphQL document IDs or action payloads, keep the method explicitly unsupported rather than fabricate success.
4. Complete event normalization and legacy callback signatures, including messages, replies, unsends, reactions, typing, read/delivery receipts, thread updates and presence where supported by observed frames.
5. Complete attachments with bounded streaming, MIME/size validation, safe temporary-file handling and tests before exposing send/upload methods.
6. Complete API declarations, README examples, compatibility matrix and package smoke tests from the same public surface.
7. Run the owner-operated live AppState acceptance check only with an authorized account; verify readiness, inbound events, recipient-confirmed send, reconnect and encrypted session recovery. Synthetic tests cannot replace this gate.

## Release gate

Do not merge to stable, publish the `latest` tag, or migrate production GoatBot until:
- Node 20 and 22 CI pass on the exact release commit;
- repository-wide GoatBot API/event inventory is complete;
- all required methods have real implementations or explicit documented unsupported status;
- owner-operated live-account checks pass for the supported feature set;
- no credentials, AppState, TOTP seeds, cookies, page tokens or encryption keys appear in fixtures, logs, commits or CI artifacts.

The personal-account transport is unofficial and not a Meta-supported API. Facebook can change endpoints and protocol behaviour without notice. Checkpoints must be resolved by the account owner; do not bypass platform security controls.

## Public reference sources

- Eryxen `fca-eryxenx` API quick reference: https://socket.dev/npm/package/fca-eryxenx/overview/4.0.3
- Separate `@eryxenx/fca` package reference: https://www.npmjs.com/package/%40eryxenx/fca
- OSV security advisory: https://osv.dev/vulnerability/MAL-2026-20276


## GoatBot listener options verified in the native compatibility layer

The current implementation forwards login-time options from the callback adapter and applies the following event behaviours: `selfListen`, `selfListenEvent`, `listenEvents`, `listenTyping`, `updatePresence`, `autoMarkDelivery`, and `autoMarkRead`. `setOptions()` updates those supported runtime flags and rejects unknown options. The native driver also forwards `userAgent`; proxy support remains explicitly unsupported. Synthetic tests cover the event filters and runtime updates. This is not complete parity with every Eryxen/FCA configuration option.


## Exact public Eryxen API checklist

The API checklist also uses the public `fca-eryxenx` 4.0.3 quick reference (a separate package from `@eryxenx/fca`). Its documented method names are:

- Messaging: `sendMessage`, `sendTypingIndicator`, `getMessage`, `editMessage`, `deleteMessage`, `unsendMessage`, `setMessageReaction`, `forwardAttachment`, `uploadAttachment`, `createPoll`.
- Receipts: `markAsRead`, `markAsReadAll`, `markAsDelivered`, `markAsSeen`.
- Threads: `getThreadInfo`, `getThreadList`, `getThreadHistory`, `deleteThread`, `changeThreadColor`, `changeThreadEmoji`, `changeGroupImage`, `setTitle`, `changeNickname`.
- Users/groups: `getUserInfo`, `getFriendsList`, `getCurrentUserID`, `createNewGroup`, `addUserToGroup`, `removeUserFromGroup`, `changeAdminStatus`.
- Auth/listening: `logout`, `getAppState`, `setOptions`, `listenMqtt`.

The public checklist is a comparison target, not proof that every method is safe, stable, or supported by Meta. E2EE, media transfer, unknown private endpoint schemas and live account behaviour require separate evidence and verification. OmegA-FCA does not inherit the reference package's credential login or external API-server design; its current login phase remains owner-supplied AppState/session only.

## Distinguish the reference packages

- `fca-eryxenx` 4.0.3: public API quick reference captured from [Socket's package overview](https://socket.dev/npm/package/fca-eryxenx/overview/4.0.3).
- `@eryxenx/fca`: separate npm package name. The OSV advisory linked below applies to the reported affected versions of this package; do not generalize it to the separate `fca-eryxenx` package without evidence.


## Latest native user/group lookup additions

- `getUserID(name)` now uses the authenticated Facebook typeahead endpoint and returns normalized user-ID entries; `getUID(profile)` resolves numeric IDs, `profile.php?id=` URLs, `/people/name/id` URLs, and vanity names.
- `resolvePhotoUrl(photoID)` uses the authenticated Mercury photo lookup and only returns HTTPS URLs on Facebook-owned CDN hosts.
- `getFriendsList()` normalizes the authenticated `/chat/user_info_all` response.
- `createNewGroup(participantIDs, title?)` uses the observed Messenger GraphQL mutation, validates participant IDs, and returns the created thread ID.
- These private Facebook endpoints are unofficial and still need authorized live-account acceptance; synthetic tests verify request construction and response normalization.
