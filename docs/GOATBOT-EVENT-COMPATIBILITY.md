# Messenger event and legacy FCA shape compatibility

**Implementation branch:** `main`  
**Reviewed Bot:** `nirzon-islam/OmegA-Goatbot@fca-migration-cleanup`  
**Scope:** Source-level normalization contract. Facebook's unofficial MQTT delta schema still requires owner-authorized live capture/acceptance.

## Implemented event contract

The `/t_ms` sync parser now normalizes the known delta classes before the native listener receives them. It keeps `rawDelta` for diagnostics/forward compatibility and emits bounded, normalized legacy-facing fields.

| Messenger delta class | Legacy event type | Normalized fields |
|---|---|---|
| `NewMessage`, `Message` | `message` | `threadID`, `messageID`, `senderID`, `userID`, `author`, `body`, `attachments`, `isGroup`, `isUnread`, `mentions` |
| Reply-bearing `NewMessage` / `Message` | `message_reply` | Message fields plus `replyToMessageID` and nested `messageReply` |
| `MessageReaction`, `Reaction` | `message_reaction` | `messageID`, `userID`, `senderID`, `reaction`, `threadID` |
| `MessageUnsend`, `UnsendMessage` | `message_unsend` | Message/thread/sender identifiers |
| `Typing`, `TypingNotification` | `typ` | `threadID`, `senderID`, `isTyping` |
| `ReadReceipt`, `MarkRead`, `ReadReceiptEvent` | `read_receipt` | `threadID`, `reader`, `userID`, `watermarkTimestamp` |
| `Presence`, `PresenceUpdate` | `presence` | `senderID`, `status` |
| Known thread/participant/admin/color/icon/call/poll events | `event` | `author`, `userID`, `logMessageType`, `logMessageData`, optional `participantIDs` |
| Unrecognized delta | `unknown_delta` | `deltaType`, `rawDelta` |

## Legacy reply shape

For a reply event, `event.messageReply` is constructed with the stable keys GoatBot's reply handlers consume:

- `messageID`
- `senderID`
- `body`
- `attachments`
- `timestamp`
- `threadID`

If the incoming delta only carries the replied-to message ID and not the quoted message body, the object still exists with that ID, an empty body/attachment list, and null values for unavailable metadata. The normalizer does not fabricate quoted content.

## Attachment normalization

The normalizer bounds the attachment list and maps common image/photo, video, audio, file/document, and sticker indicators into legacy `type` values. It maps observed URL/URI/download URL variants to `url`, and observed ID variants to both `ID` and `id`. Unknown attachment metadata is retained rather than discarded. Malformed entries are skipped.

This is metadata normalization only. It does not download media, create expiring CDN URLs, or guarantee every private Facebook attachment variant exposes a usable URL.

## Safety and bounds

- JSON payload: maximum 2 MiB.
- Delta array: maximum 500 entries per sync envelope.
- Attachment list: maximum 100 entries per message.
- Text body: maximum 100,000 characters.
- Object depth: maximum 24.
- Numeric Facebook IDs are normalized to strings.
- Unknown delta classes remain explicitly marked `unknown_delta`; they are not silently mislabeled as messages.
- `rawDelta` is preserved; consumers must not log it without redaction.

## Verification and limitations

Synthetic tests cover ordinary messages, replies with and without quoted content, attachment URL/type/ID normalization, reactions, unsends, typing, read receipts, presence, participant events, unknown deltas, numeric IDs and malformed attachment entries.

This closes the previously identified source-level gaps for GoatBot's `messageReply` access and `read_receipt` dispatch. It does not prove that Facebook currently emits every listed delta class or nested field. Native MQTT's Facebook-specific topics, sync deltas and private event payloads remain unofficial and must be verified with a valid AppState on a controlled account before calling the event pipeline live-complete.
