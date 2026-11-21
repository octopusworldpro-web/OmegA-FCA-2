# Messenger attachment pipeline

**Implementation branch:** `main`  
**Compatibility reference:** legacy FCA `sendMessage({ attachment })` upload-and-send flow and `forwardAttachment()` endpoint conventions.  
**Scope:** owner-authorized personal Messenger sessions only. Facebook's private web endpoints are unofficial and may change.

## Public methods

### Upload

`api.uploadAttachment(streamOrBuffer)` or `api.uploadAttachment([file1, file2])` uploads one or more files and returns normalized metadata containing `attachmentID`, `idKey`, `type`, `fileName`, `mimeType`, and `size`. Supported input types are Node readable streams, Buffer, Uint8Array, and Blob.

The upload pipeline posts multipart data to the observed Messenger Mercury upload endpoint, reads the per-file metadata, and requires a supported ID field (`image_id`, `video_id`, `audio_id`, `file_id`, or `gif_id`). Partial or malformed upload responses are errors; no synthetic IDs are returned.

### Send

The normal legacy facade form remains supported:

```js
api.sendMessage({
  body: "Here is the file",
  attachment: fs.createReadStream("./report.pdf")
}, threadID, callback);
```

Promise/object form is also supported:

```js
await api.sendMessage({
  threadID,
  message: { body: "Here is the file", attachment: fileBuffer },
  replyToMessageID
});
```

One or multiple attachments can be sent with a text caption. The send pipeline uploads first, groups returned IDs into the matching image/GIF/video/audio/file fields, then submits the legacy Messenger message form. Reply metadata and mentions are preserved. Text-only and sticker messages continue to use the native MQTT send path. URL-share messages use the observed `message_share_attachment/fromURI` preparation flow and the legacy send endpoint.

### Download

`api.downloadAttachment(url, options?)` returns `{ buffer, size, mimeType, fileName, url }`. Only HTTPS Facebook/Messenger media hosts are accepted (`fbcdn.net`, `fbsbx.com`, `facebook.com`, `messenger.com`). Redirects are revalidated, no session cookie is sent to the media CDN, and response bytes are bounded while streaming.

### Forward

`api.forwardAttachment(attachmentID, userOrUsers, callback?)` forwards an existing attachment ID to one or more numeric Facebook recipients using the observed `/mercury/attachments/forward/` request. It validates IDs and recipient count and rejects Facebook-declared failures.

## Limits and safety

- At most 10 attachments in one upload/send.
- 10 MiB maximum per upload and 10 MiB combined per upload batch.
- 25 MiB maximum download (configurable lower limit).
- 30-second default download timeout; 1–120 seconds configurable.
- Download redirect chain limited to five responses and every redirect target is revalidated.
- Only HTTPS media URLs on allowlisted Facebook domains; credentials in URLs are rejected.
- No automatic fetching of arbitrary user-provided URLs. URL-share metadata preparation is a separate explicit send action.
- Upload/send failures are surfaced; the API never reports success without a Facebook response containing a message ID.

## Verification boundary

Synthetic tests cover Buffer/stream input, MIME detection, file naming, size bounds, upload metadata parsing, attachment ID grouping, send response parsing, reply metadata, CDN URL allowlisting, download bounds, and multi-recipient forwarding.

Facebook personal-account endpoints are unofficial and subject to server-side changes. CI proves deterministic code behavior only; live upload, recipient delivery, download CDN access and forwarding must still be acceptance-tested with the owner's authorized AppState. End-to-end encrypted Messenger attachments require the separate E2EE media-key/blob pipeline and are not claimed supported here.
