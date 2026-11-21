# GoatBot FCA call-site inventory

**Audit date:** 2026-11-21  
**Target repository:** \`nirzon-islam/OmegA-Goatbot\`  
**Target branch:** \`fca-migration-cleanup\`  
**Audited tree:** \`b9cddf7e8bb886aaf2f66e20f5fd38b5624dc93c\`  
**OmegA-FCA target:** \`octopusworldpro-web/OmegA-FCA-2\`, \`main\`  
**Purpose:** Complete static inventory of FCA methods, callback/lifecycle usage, event contracts, option forwarding and Bot call-site compatibility. This is an audit; it does not claim live Facebook acceptance.

## 1. Scope and method

The target tree contained 363 tracked blobs, including **271 JavaScript files** and 28 Eta templates. All 271 JavaScript files were scanned, including the eight vendored/minified JavaScript files; all 28 Eta templates were also checked for direct FCA calls. The package manifest, lockfile metadata, account configuration, login adapter, core handlers, database controllers and dashboard verification route were inspected in detail.

The scan covered the Bot runtime, commands, event handlers, custom scripts, database, dashboard and login/session lifecycle. It recorded direct FCA method references and conditionally invoked private hooks. No live AppState was used for testing and no GoatBot source/configuration was modified by this audit.

## 2. Native integration path found

The active Bot integration is:

1. \`bot/login/omegaFca.js\` imports \`createFacebookMqttClient()\` and wraps it with \`createGoatBotLogin()\`.
2. \`bot/login/login.js\` invokes the callback-style \`login({ appState }, options, callback)\`, stores the returned API, reads the current account ID, starts SessionGuard when configured and starts \`listenMqtt()\`.
3. \`bot/login/secureSession.js\` validates AppState account identity and waits for the synthetic \`ready\` event before accepting an account switch.
4. \`bot/login/loadData.js\` uses the API for startup database synchronization and conditionally probes a private E2EE hook.
5. \`bot/handler/handlerAction.js\` dispatches incoming FCA events to GoatBot command/event handlers.

**Version mismatch:** the reviewed GoatBot \`package.json\` pins \`@nirzon-islam/omega-fca@0.1.6-rc.2\`, while the current OmegA-FCA main package is \`0.1.6-rc.3\`. Therefore, this source audit describes the current FCA-2 main implementation, but the reviewed Bot dependency pin does not yet consume that exact prerelease.

## 3. Complete direct API inventory

### Login, identity and lifecycle

| API / hook | GoatBot call sites | Current FCA-2 status |
|---|---|---|
| \`login({ appState }, options, callback)\` | \`bot/login/login.js\`, \`bot/login/secureSession.js\`; adapter: \`bot/login/omegaFca.js\` | Callback adapter exists; native AppState/MQTT path is experimental and live acceptance is pending. |
| \`getCurrentUserID()\` | \`bot/login/login.js\`, \`bot/login/loadData.js\`, \`scripts/cmds/setting.js\`, \`scripts/cmds/allbox.js\`, \`scripts/events/welcome.js\` and other command helpers | Native identity method exists. |
| \`listenMqtt(callback)\` | \`bot/login/login.js\`, \`bot/login/secureSession.js\` | Native callback facade and synthetic ready event exist; real broker/event compatibility remains unverified. |
| \`stopListening(callback?)\` | \`bot/login/login.js\` | Facade lifecycle method exists. |
| \`sessionGuard(path, options)\` / \`stopSessionGuard()\` | \`bot/login/login.js\` | Encrypted sidecar integration exists; it does not write encrypted bytes into GoatBot's \`account.txt\`. |
| \`getAppState()\` | \`scripts/cmds/getfbstate.js\` | Exposed; sensitive owner-only session data. |
| \`getCookies()\` | \`scripts/cmds/suspend.js\` | Exposed; sensitive cookie header. |
| \`refreshFb_dtsg()\` | \`bot/custom.js\` | Exposed token refresh helper. |
| \`getHumanizer()\` | \`bot/login/humanizerOptions.js\` | Exposed after listener startup; used by the Bot's humanizer configuration. |
| \`setOptions(options)\` | \`bot/login/loadData.js\`, \`scripts/cmds/setting.js\` | Native runtime options exist, but only the documented allowlist is accepted. |

### Messaging and receipts

| API | GoatBot call sites / use | Current FCA-2 status |
|---|---|---|
| \`sendMessage(message, threadID, callback, replyToMessageID)\` | Widely used by commands, \`utils.js\`, event handlers and \`dashboard/routes/verifyfbid.js\` | Text/sticker/reply MQTT task builder is experimental. Attachment and URL payloads are explicitly rejected. |
| \`editMessage(text, messageID, callback)\` | \`scripts/cmds/catbox.js\`, \`ffinfo.js\`, \`goatstore.js\`, \`math.js\`, \`slot.js\`, \`trading.js\` | Native correlated MQTT task builder exists; live acceptance is pending. |
| \`unsendMessage(messageID, callback)\` | \`bot/handler/handlerAction.js\`, \`scripts/cmds/clear.js\`, \`delete.js\`, \`download.js\`, \`goatstore.js\`, \`math.js\`, \`quiz.js\`, \`sendnoti.js\`, \`tiktok.js\` | Native web action exists with synthetic success/error tests; live acceptance is pending. |
| \`setMessageReaction(reaction, messageID, callback, ...)\` | \`utils.js\`, \`anisearch.js\`, \`autolink.js\`, \`autoreact.js\`, \`edit.js\`, \`edit2.js\`, \`gan.js\`, \`gcimg.js\`, \`imagen3.js\`, \`prompt.js\`, \`sing.js\`, \`tiktok.js\`, \`video.js\`, \`webss.js\` | Native web action exists with synthetic tests; extra legacy positional arguments are ignored. |
| \`markAsRead(threadID)\` | \`bot/handler/handlerEvents.js\`, \`scripts/cmds/autoseen.js\` | Native web action exists with synthetic tests. |
| \`markAsDelivered(threadID, messageID)\` | \`bot/handler/handlerEvents.js\` | Native web action exists with synthetic tests. |
| \`shareContact(text, senderID, threadID, messageID?, callback?)\` | \`scripts/cmds/uid.js\` | Native MQTT task builder exists; legacy fourth message-ID placeholder is accepted but not used. |

### Threads, users and groups

| API | GoatBot call sites | Current FCA-2 status |
|---|---|---|
| \`getThreadList(limit, timestamp, tags)\` | \`bot/login/loadData.js\`, \`scripts/cmds/allbox.js\`, \`join.js\`, \`pending.js\`, \`setting.js\` | Native web action exists; limit is 1–100 and tags must be an array. |
| \`getThreadInfo(threadID)\` | \`scripts/cmds/activemember.js\`, \`adduser.js\`, \`anti_isis_leave.js\`, \`boxinfo.js\`, \`count.js\`, \`filteruser.js\`, \`pair.js\`, \`protect.js\`, \`setname.js\`, \`supportgc.js\`, \`scripts/events/autoUpdateInfoThread.js\`, \`welcome.js\`, \`scripts/utils/threadSync.js\`, \`database/controller/threadsData.js\` | Native web action exists with synthetic tests. |
| \`getThreadHistory(threadID, amount)\` | \`scripts/cmds/activemember.js\`, \`clear.js\` | Native web action exists; amount is capped at 100. |
| \`getUserInfo(userIDs)\` | \`scripts/cmds/activemember.js\`, \`autoreply.js\`, \`baby.js\`, \`ludo.js\`, \`supportgc.js\`, \`scripts/events/antileave.js\`, \`welcome.js\`, \`database/controller/usersData.js\` | Native web action exists and returns normalized user data; live endpoint acceptance is pending. |
| \`getUID(profile)\` | \`scripts/cmds/pp.js\` | Native resolver exists. |
| \`addUserToGroup(userID, threadID)\` | \`scripts/cmds/adduser.js\`, \`join.js\`, \`supportgc.js\`, \`scripts/events/antileave.js\` | Native web action exists with synthetic tests. |
| \`removeUserFromGroup(userID, threadID)\` | \`scripts/cmds/allbox.js\`, \`anti_isis_leave.js\`, \`badwords.js\`, \`ban.js\`, \`filteruser.js\`, \`kick.js\`, \`kickall.js\`, \`out.js\`, \`pending.js\`, \`warn.js\`, \`scripts/events/checkwarn.js\` | Native web action exists with synthetic tests. |
| \`changeNickname(name, threadID, userID)\` | \`scripts/cmds/antichangeinfobox.js\`, \`autosetname.js\`, \`pending.js\`, \`protect.js\`, \`setname.js\`, \`setting.js\`, \`scripts/events/welcome.js\` | Native web action exists with synthetic tests. |
| \`changeGroupImage(image, threadID)\` | \`scripts/cmds/antichangeinfobox.js\`, \`groupimage.js\` | Bounded image upload plus MQTT change action exists; live acceptance is pending. |
| \`changeAvatar(image, caption, expiration, callback)\` | \`scripts/cmds/setavt.js\` | Bounded image upload and profile update path exists; live acceptance and expiration-unit parity remain unverified. |
| \`setTitle(title, threadID)\` | \`scripts/cmds/antichangeinfobox.js\`, \`groupname.js\`, \`protect.js\` | Native web action exists with synthetic tests. |
| \`changeThreadColor(color, threadID)\` | \`scripts/cmds/antichangeinfobox.js\`, \`protect.js\` | Native web action exists with synthetic tests. |
| \`changeThreadEmoji(emoji, threadID)\` | \`scripts/cmds/antichangeinfobox.js\`, \`group_Emoji.js\`, \`protect.js\` | Native web action exists with synthetic tests. |

### Conditional / private hooks

- \`api._connectE2EEAndMerge()\` appears in \`bot/login/loadData.js\`, guarded by a runtime function check and the Bot's \`config.e2ee.enable\` flag. It is not a public FCA method.
- \`api.e2ee.isConnected()\` is not called by the scanned Bot source.
- \`httpGet()\` and \`httpPost()\` are exposed by FCA-2, but no direct GoatBot API call to either was found in this branch scan.
- \`createNewGroup()\`, \`getMessage()\`, \`getFriendsList()\`, \`getUserID(name)\`, \`resolvePhotoUrl()\`, \`markAsReadAll()\` and \`markAsSeen()\` were not found as direct GoatBot call sites.
- \`sendTypingIndicator()\` is used internally by FCA-2's humanizer middleware; the Bot configures it through \`getHumanizer()\` rather than calling it directly.

## 4. Critical signature and payload mismatches

These are concrete source-level incompatibilities, not hypothetical feature requests.

### A. Startup auto-sync calls an unsupported getThreadList shape

\`bot/login/loadData.js\` calls:

\`\`\`js
api.getThreadList(9999999, null, "INBOX")
\`\`\`

FCA-2 currently validates a maximum limit of 100 and requires \`tags\` to be an array. The call therefore fails validation if \`database.autoSyncWhenStart\` is enabled. The checked-in config currently sets this option to false, so the path is conditional rather than part of every startup.

### B. One command requests more thread history than FCA-2 accepts

\`scripts/cmds/activemember.js\` calls \`getThreadHistory(threadID, 1000)\`. FCA-2 currently accepts 1–100 messages per request. This call fails validation; it needs a bounded/paginated implementation or a compatible limit.

### C. Attachment-bearing sendMessage payloads are not supported

\`scripts/cmds/leaderboard.js\` sends an object containing an attachment stream. The native MQTT message builder explicitly rejects \`message.attachment\` and \`message.url\`; it supports text, sticker and reply only. Other media commands and image workflows also rely on attachments or attachment-shaped message objects. This is a real Bot compatibility blocker and must not be treated as a successful send.

### D. Legacy reply event object is missing

GoatBot commands access \`event.messageReply\`, including:
- \`scripts/cmds/edit.js\` — \`event.messageReply.attachments[0].url\`
- \`scripts/cmds/imgbb.js\` — \`event.messageReply.attachments\` and attachment \`type\`/\`url\`
- \`scripts/cmds/groupimage.js\` — \`event.messageReply.attachments\`
- \`scripts/cmds/uid.js\` and \`pp.js\` — \`event.messageReply.senderID\`

The current native event normalizer can label a message as \`message_reply\`, but it does not construct the legacy nested \`messageReply\` object. It also copies raw delta attachments rather than guaranteeing the legacy \`type\` and \`url\` fields. Reply-based commands therefore do not yet have full event-shape compatibility.

### E. Read-receipt event name mismatch

FCA-2's current Messenger delta normalizer emits \`type: "read"\` for \`ReadReceipt\` / \`MarkRead\`. GoatBot's \`bot/handler/handlerAction.js\` dispatches \`read_receipt\`. The read-receipt handler will not run for the currently emitted \`read\` event.

### F. E2EE is not wired

The Bot has an E2EE setting and conditionally probes \`_connectE2EEAndMerge()\`. FCA-2's client explicitly reports \`getCapabilities().e2ee === false\`, does not expose that private hook and does not normalize decrypted E2EE messages with \`isE2EE\`. The checked-in Bot config defaults E2EE off. Turning the setting on does not make E2EE functional.

### G. sendMessage positional reply argument mismatch

The native facade follows the legacy callback shape: \`sendMessage(message, threadID, callback, replyToMessageID)\`. Several Bot commands pass a message ID as the third argument. A non-function third argument is not interpreted as a reply target by the current facade; the reply target belongs in the fourth argument. These call sites need correction or a deliberately compatible overload.

## 5. Login option compatibility

The checked-in \`config.optionsFca\` includes \`forceLogin\`, \`listenEvents\`, \`updatePresence\`, \`listenTyping\`, \`logLevel\`, \`selfListen\`, \`selfListenEvent\`, \`autoMarkDelivery\` and \`autoReconnect\`.

FCA-2's native driver consumes \`userAgent\`, \`online\`, \`selfListen\`, \`selfListenEvent\`, \`listenEvents\`, \`listenTyping\`, \`updatePresence\`, \`autoMarkDelivery\` and \`autoMarkRead\`. Its runtime \`setOptions()\` allowlist is \`logLevel\`, \`selfListen\`, \`selfListenEvent\`, \`listenEvents\`, \`listenTyping\`, \`updatePresence\`, \`autoMarkDelivery\` and \`autoMarkRead\`.

- \`forceLogin\` and \`autoReconnect\` are not consumed as login options by the current native driver. Reconnect policy is configured separately through the client factory's \`reconnect\` object.
- \`proxy\` is explicitly rejected by the native transport when configured.
- \`autoMarkRead\` is supported by FCA-2 but is not present in the checked-in GoatBot \`optionsFca\` block.
- Unknown runtime \`setOptions()\` keys are rejected rather than silently accepted.

## 6. Event contract inventory

The GoatBot dispatcher in \`bot/handler/handlerAction.js\` handles these event names:

- \`message\`, \`message_reply\`, \`message_unsend\`
- \`event\`
- \`message_reaction\`
- \`typ\`
- \`presence\`
- \`read_receipt\`

FCA-2 currently normalizes these observed delta classes:

| Facebook delta class | FCA-2 event type | GoatBot compatibility |
|---|---|---|
| \`NewMessage\`, \`Message\` | \`message\` or \`message_reply\` | Partial: core IDs/body exist, but nested \`messageReply\` and legacy attachment normalization are missing. |
| \`MessageReaction\`, \`Reaction\` | \`message_reaction\` | Core event name and reaction/user ID fields align. |
| \`MessageUnsend\`, \`UnsendMessage\` | \`message_unsend\` | Event name aligns. |
| \`Typing\`, \`TypingNotification\` | \`typ\` | Event name aligns. |
| \`ReadReceipt\`, \`MarkRead\` | \`read\` | Mismatch: GoatBot expects \`read_receipt\`. |
| \`Presence\`, \`PresenceUpdate\` | \`presence\` | Event name aligns; live payload shape remains unverified. |
| \`ThreadEvent\`, \`ThreadName\`, \`ParticipantAdded\`, \`ParticipantRemoved\` | \`event\` | Partial: normalized as \`logMessageType\` / \`logMessageData\`; all legacy subtypes are not mapped. |
| Other classes | \`unknown_delta\` | Not dispatched as a legacy event. |

No live Facebook capture was used to assert that the above unofficial delta class names are current or exhaustive.

## 7. Source files with direct FCA call sites

The scan found direct FCA calls in the following first-party Bot source groups.

**Runtime, login and handlers:**  
\`bot/custom.js\`, \`bot/handler/handlerAction.js\`, \`bot/handler/handlerEvents.js\`, \`bot/login/humanizerOptions.js\`, \`bot/login/loadData.js\`, \`bot/login/login.js\`, \`bot/login/omegaFca.js\`, \`bot/login/secureSession.js\`, \`utils.js\`.

**Commands:**  
\`scripts/cmds/activemember.js\`, \`adduser.js\`, \`age.js\`, \`allbox.js\`, \`aniinfo.js\`, \`anisearch.js\`, \`anti_isis_leave.js\`, \`antichangeinfobox.js\`, \`autolink.js\`, \`autoreact.js\`, \`autoreply.js\`, \`autoseen.js\`, \`autosetname.js\`, \`baby.js\`, \`badwords.js\`, \`ban.js\`, \`bet.js\`, \`boxinfo.js\`, \`butslap.js\`, \`callad.js\`, \`catbox.js\`, \`clear.js\`, \`count.js\`, \`daily.js\`, \`delete.js\`, \`download.js\`, \`edit.js\`, \`edit2.js\`, \`emojimix.js\`, \`fbcover.js\`, \`ffinfo.js\`, \`filteruser.js\`, \`gan.js\`, \`gcimg.js\`, \`getfbstate.js\`, \`goatstore.js\`, \`group_Emoji.js\`, \`group_refresh.js\`, \`groupimage.js\`, \`groupname.js\`, \`imagen3.js\`, \`imgbb.js\`, \`imggen.js\`, \`imgur.js\`, \`join.js\`, \`kick.js\`, \`kickall.js\`, \`kiss2.js\`, \`leaderboard.js\`, \`ludo.js\`, \`manga.js\`, \`math.js\`, \`mia.js\`, \`mp3.js\`, \`notification.js\`, \`out.js\`, \`owner.js\`, \`pair.js\`, \`pending.js\`, \`poli.js\`, \`pp.js\`, \`prompt.js\`, \`protect.js\`, \`quiz.js\`, \`rbg.js\`, \`remini.js\`, \`restart.js\`, \`sdxl.js\`, \`sendnoti.js\`, \`setavt.js\`, \`setname.js\`, \`setting.js\`, \`sing.js\`, \`slot.js\`, \`states.js\`, \`supportgc.js\`, \`suspend.js\`, \`tag.js\`, \`tempmail.js\`, \`tiktok.js\`, \`time.js\`, \`toilet.js\`, \`tradeguide.js\`, \`trading.js\`, \`trash.js\`, \`uid.js\`, \`up.js\`, \`update.js\`, \`video.js\`, \`warn.js\`, \`webss.js\`, \`wgen.js\`, \`wish.js\`, \`youtube.js\`.

**Events, database and dashboard:**  
\`scripts/events/antileave.js\`, \`autoUpdateInfoThread.js\`, \`checkwarn.js\`, \`logsbot.js\`, \`welcome.js\`, \`scripts/utils/threadSync.js\`, \`database/controller/threadsData.js\`, \`database/controller/usersData.js\`, \`dashboard/routes/verifyfbid.js\`.

The remaining JavaScript files and Eta templates did not add another direct FCA method call to this inventory. Static/vendor files were included in the scan; no FCA callsite was found in those files.

## 8. Security findings discovered during the audit

The reviewed GoatBot branch tracks a non-empty \`account.txt\` containing a JSON cookie/AppState array. The tracked \`config.json\` also contains non-empty secret-bearing configuration fields, including a database URI, API key, OAuth client material and a reCAPTCHA secret.

No values are reproduced here. If these are genuine live credentials/session cookies, treat them as exposed: revoke the Facebook session, rotate/revoke the affected service credentials, and remove the sensitive material from the repository and its history. This audit did not modify those files.

## 9. Audit conclusion and hand-off

**Call-site inventory item #1 is complete for the reviewed tree.** The full 271-file JavaScript scan, Eta template scan, core integration review and method/event/option inventory are recorded here.

This does **not** mean FCA-2 is a complete drop-in replacement. The concrete blockers found by the audit are:

1. Thread-list limit/tag signature mismatch in startup auto-sync.
2. Thread-history limit mismatch in the active-member command.
3. Missing generic message attachment send/forward support.
4. Missing legacy \`messageReply\` object and attachment normalization.
5. Read-receipt event-name mismatch.
6. No E2EE implementation or E2EE event support.
7. Some legacy \`sendMessage\` call sites pass the reply ID in the wrong positional slot.
8. GoatBot still pins \`0.1.6-rc.2\`, not the current FCA-2 \`0.1.6-rc.3\`.

The next implementation work should address these contracts without returning dummy success, and then run GoatBot's startup/command contract tests. Live acceptance still requires an owner-authorized AppState and a controlled Facebook account; synthetic CI cannot prove broker acceptance or recipient delivery.
