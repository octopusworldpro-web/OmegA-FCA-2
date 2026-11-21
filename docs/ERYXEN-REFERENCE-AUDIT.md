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
| Messages | sendMessage, editMessage, unsendMessage, deleteMessage, getMessage, broadcast | sendMessage is experimental; unsendMessage is implemented with synthetic web-action tests; `deleteMessage` (delete-for-me) is implemented with a separate authenticated endpoint; `deleteThread` supports one or multiple IDs; `editMessage` and `shareContact` have native MQTT request builders with synthetic response tests; `getMessage` is implemented as a lookup in the latest 100 normalized thread-history messages; `sendBroadcast` remains a higher-level helper not yet implemented |
| Attachments and media | uploadAttachment, forwardAttachment, sendImage, sendVideo, sendAudio, sendFile, sendGif, sendLocation, shareLink, shareContact | `changeGroupImage` and `changeAvatar` perform bounded JPEG/PNG/GIF/WebP multipart uploads with MIME sniffing and response validation; generic message attachments, downloads, forwarding and attachment event parity remain missing; do not return dummy success |
| Reactions and receipts | setMessageReaction, markAsRead, markAsReadAll, markAsDelivered, markAsSeen, typing | setMessageReaction, markAsRead, markAsDelivered and sendTypingIndicator have first-party synthetic-tested paths; markAsReadAll and markAsSeen now have authenticated web-action implementations with callback/Promise support and synthetic tests |
| Threads | getThreadList, getThreadInfo, getThreadHistory, getMessage, createGroup, deleteThread, muteThread, archive, request handling, search | list/info/history, latest-100 `getMessage`, typeahead `getUserID`, `getFriendsList`, `getUID`, `resolvePhotoUrl`, `createNewGroup`, and selected group operations now have synthetic-tested adapters; deleteThread, muteThread and changeArchivedStatus now have authenticated web-action implementations with synthetic tests; changeAdminStatus, createPoll, handleMessageRequest, searchForThread and getThreadPictures now have first-party implementations with synthetic tests |
| Thread customization | setTitle, changeThreadColor, changeThreadEmoji, changeNickname, changeGroupImage, changeAdminStatus, polls, pin/unpin | title/color/emoji/nickname and add/remove member paths have synthetic-tested adapters; group-image upload plus MQTT change action is implemented with synthetic tests; admin/poll/pin operations remain missing or unverified |
| Users and social | getUserInfo, getUID, getFriendsList, avatar/profile/public data, friend/block/follow actions, post/comment/share/reactions | getUserInfo is implemented with synthetic tests; other methods are missing or require an evidence-backed contract |
| HTTP helpers | httpGet, httpPost, multipart form data | bounded authenticated Facebook/Messenger HTTPS web client exposes Promise/callback `httpGet` and `httpPost`; multipart upload is used by profile/group image changes. Generic multipart/attachment compatibility remains incomplete |
| Higher-level helpers | namespaced client, MessengerBot, sendBroadcast, humanizer | not part of the minimum FCA compatibility layer yet; assess after flat API and event parity |

## Implementation order

1. Keep the Node 20/22 CI matrix green and retain deterministic tests for MQTT CONNECT/CONNACK, SUBACK, keepalive cadence, cursor recovery, listener teardown and reconnect.
2. **Complete.** The full scan of all 271 GoatBot JavaScript files and 28 Eta templates is recorded in [GOATBOT-CALLSITE-INVENTORY.md](GOATBOT-CALLSITE-INVENTORY.md), including method-to-file mapping, event types, login options, dynamic E2EE hook and security findings.
3. Resolve the concrete call-site mismatches in the inventory: thread-list limit/tags, thread-history limit, attachment-bearing sends, legacy reply objects, read-receipt event naming and sendMessage positional reply arguments. Implement only evidence-backed request contracts; never fabricate success.
4. Complete event normalization and legacy callback signatures, including messages, replies, unsends, reactions, typing, read/delivery receipts, thread updates and presence where supported by observed frames.
5. Complete attachments with bounded streaming, MIME/size validation, safe temporary-file handling and tests before exposing send/upload methods.
6. Complete API declarations, README examples, compatibility matrix and package smoke tests from the same public surface.
7. Run the owner-operated live AppState acceptance check only with an authorized account; verify readiness, inbound events, recipient-confirmed send, reconnect and encrypted session recovery. Synthetic tests cannot replace this gate.

## Release gate

Do not merge to stable, publish the `latest` tag, or migrate production GoatBot until:
- Node 20 and 22 CI pass on the exact release commit;
- the completed 271-file GoatBot API/event inventory is maintained in `GOATBOT-CALLSITE-INVENTORY.md`;
- all required methods have real implementations or explicit documented unsupported status;
- owner-operated live-account checks pass for the supported feature set;
- no credentials, AppState, TOTP seeds, cookies, page tokens or encryption keys appear in fixtures, logs, commits or CI artifacts.

The personal-account transport is unofficial and not a Meta-supported API. Facebook can change endpoints and protocol behaviour without notice. Checkpoints must be resolved by the account owner; do not bypass platform security controls.

## Public reference sources

- Eryxen `fca-eryxenx` API quick reference: https://socket.dev/npm/package/fca-eryxenx/overview/4.0.3
- Separate `@eryxenx/fca` package reference: https://www.npmjs.com/package/%40eryxenx/fca
- OSV security advisory: https://osv.dev/vulnerability/MAL-2026-20276


## GoatBot listener options verified in the native compatibility layer

The current implementation forwards login-time options from the callback adapter and applies the following event behaviours: `selfListen`, `selfListenEvent`, `listenEvents`, `listenTyping`, `updatePresence`, `autoMarkDelivery`, and `autoMarkRead`. `setOptions()` updates those supported runtime flags and rejects unknown options. The native driver also forwards `userAgent`; proxy support remains explicitly unsupported. Synthetic tests cover the event filters and runtime updates. This is not complete parity with every Eryxen/FCA configuration option. The full GoatBot option comparison and the unconsumed `forceLogin` / `autoReconnect` settings are documented in `GOATBOT-CALLSITE-INVENTORY.md`.


## GoatBot call-site audit hand-off

The repository-wide call-site inventory is complete for the reviewed GoatBot tree. It surfaced additional compatibility blockers that are not visible from a method-name-only API comparison:

- GoatBot startup auto-sync passes `getThreadList(9999999, null, "INBOX")`, but the native method currently accepts a 1–100 limit and an array of tags.
- One command requests 1,000 thread-history messages, while the native method caps each call at 100.
- Attachment-bearing `sendMessage` payloads are rejected by the current MQTT send builder.
- The native normalizer does not build the legacy nested `event.messageReply` object and does not normalize raw attachments to the legacy `type` / `url` shape.
- The normalizer emits read receipts as `read`; GoatBot dispatches `read_receipt`.
- GoatBot conditionally calls the private `_connectE2EEAndMerge()` hook; FCA-2 reports E2EE as unsupported and does not expose the hook.
- The reviewed GoatBot dependency remains pinned to `0.1.6-rc.2`, while FCA-2 main is `0.1.6-rc.3`.

These findings complete audit item #1, not the implementation or live-acceptance gates. See [GOATBOT-CALLSITE-INVENTORY.md](GOATBOT-CALLSITE-INVENTORY.md) for the full method-to-file mapping and security notes.

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


## Remaining FCA API implementation update (2026-11-21)

The following previously missing flat FCA methods have now been implemented in the first-party facebookThreadApi and exposed through the authenticated client facade. They support Promise use and the legacy error-first callback form:

| Method | Request contract | Semantics |
|---|---|---|
| `markAsReadAll(callback?)` | `POST /ajax/mercury/mark_folder_as_read.php`, `folder=inbox` | Marks the inbox folder read |
| `markAsSeen(timestamp?, callback?)` | `POST /ajax/mercury/mark_seen.php`, `seen_timestamp` | Updates the account's seen watermark |
| `deleteMessage(messageIDs, callback?)` | `POST /ajax/mercury/delete_messages.php`, `client=mercury`, indexed `message_ids[n]` | Deletes one or more messages from this account's view; distinct from unsend |
| `deleteThread(threadIDs, callback?)` | `POST /ajax/mercury/delete_thread.php`, `client=mercury`, indexed `ids[n]` | Removes one or more threads from the inbox |
| `muteThread(threadID, seconds, callback?)` | `POST /ajax/mercury/change_mute_thread.php`, `thread_fbid`, `mute_settings` | -1 permanent, 0 unmute, positive duration in seconds |
| `changeArchivedStatus(threadIDs, archive, callback?)` | `POST /ajax/mercury/change_archived_status.php`, `ids[threadID]` | Archives or unarchives one or more threads |

Each action validates IDs and input bounds and rejects Facebook-declared errors rather than returning a synthetic success. Regression tests cover the endpoint, payload, callback form, validation and rejection paths.

Still not claimed as complete: deleteMessage/thread mutation endpoints need authorized live-account acceptance; changeAdminStatus, createPoll, searchForThread, getThreadPictures, handleMessageRequest, broadcast, namespaced client, MessengerBot and E2EE remain separate implementation gaps. No EryXen runtime code or dependencies were copied into FCA-2.


### Additional thread/group actions (2026-11-21)

The native adapter now also implements `changeAdminStatus`, `createPoll`, `handleMessageRequest`, `searchForThread` and `getThreadPictures`. Each has argument validation, Facebook error checks, callback/Promise compatibility, TypeScript declarations, and synthetic regression coverage. The poll endpoint is legacy/private and may change; live acceptance remains required. `getThreadPictures` validates photo IDs returned by Facebook before issuing detail requests.


### Account/profile and utility methods (2026-11-21)

The native adapter also now implements `changeBlockedStatus`, `changeBio`, `unfriend` and `getEmojiUrl`. The first three use authenticated Facebook web actions/GraphQL and reject Facebook-declared failures; `getEmojiUrl` computes the Facebook emoji asset URL locally. Their declarations and synthetic regression tests are included. The legacy bio GraphQL document ID and all account mutation endpoints require authorized live-account acceptance before being treated as stable.

The current new-method test batch passes 346/346 tests on Node.js 20 and Node.js 22; syntax checks, package-root export smoke tests and publishable-package checks also pass on both versions (CI run 44867338258).


### Multi-thread broadcast helper (2026-11-21)

`sendBroadcast(message, threadIDs, options?, callback?)` is now available through the native driver and client facade. It validates unique numeric thread IDs, bounds recipient count, delay and parallelism, processes recipients in bounded parallel batches, calls `onEach(error, result, threadID)` per recipient, and returns `{ total, sent, failed, results }` so partial failures are visible. It reuses the native text/attachment send paths rather than inventing a second transport. Unit tests cover partial failures, pacing configuration, validation and callback overloads.


### E2EE compatibility update (2026-11-21)

The previously missing `_connectE2EEAndMerge()` compatibility hook now exists as an alias for `connectE2EE()`. The native driver also exposes `sendE2EEMessage`, `sendE2EEAttachment`, `downloadE2EEAttachment`, `isE2EEThread`, and `getE2EEStatus`; E2EE message events are merged into the normal listener. The MIT-licensed one-to-one implementation is ported from `bhhoang/fbapi-unofficial` with its copyright/license notice preserved in `THIRD_PARTY_NOTICES.md`. Persistent identity/prekey/session data is AES-256-GCM encrypted at rest using an explicit 32-byte storage key. This does not implement group Sender Keys/SKDM, Labyrinth backup/restore, E2EE calls or key transparency. Private Meta ICDC/Noise endpoints still require authorized live-account acceptance.
