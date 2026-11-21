# Messenger E2EE support

OmegA-FCA includes a MIT-licensed Messenger E2EE client ported and adapted from
[bhhoang/fbapi-unofficial](https://github.com/bhhoang/fbapi-unofficial).
The upstream MIT notice is retained in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
No AGPL Signal library or AGPL E2EE toolkit is included.

## Current scope

- Separate Messenger E2EE Noise WebSocket connection.
- Device registration, identity key, signed prekey and one-time prekey lifecycle.
- Per-device Signal-style sessions and ratcheted one-to-one encrypted text messages.
- Encrypted one-to-one media upload/download with hash and HMAC verification.
- Incoming E2EE message, edit, reaction and revoke event normalization.
- Retry receipts and device-list invalidation handling.
- AES-256-GCM encrypted local device store when a storage key is configured.
- E2EE events are merged into the ordinary \`listen()\` callback.

**Not implemented / not claimed:** group Sender Keys/SKDM, E2EE group media, Labyrinth encrypted history backup/restore, E2EE calls, and key-transparency verification. The implementation must not be described as complete Messenger E2EE for group chats or backups.

Meta documents Messenger's one-to-one client-fanout Signal sessions, group Sender Keys,
encrypted media and Noise transport in its [Messenger E2EE overview](https://engineering.fb.com/wp-content/uploads/2023/12/MessengerEnd-to-EndEncryptionOverview_12-6-2023.pdf).
This port covers the one-to-one text/media path only.

## Usage

\`\`\`js
const { createFacebookMqttClient } = require("@nirzon-islam/omega-fca");

const client = createFacebookMqttClient({
  // Recommended: set FCA_E2EE_KEY to 64 random hex characters (32 bytes).
  e2eeStorageKey: process.env.FCA_E2EE_KEY,
  // Optional; defaults to ~/.omega-fca/e2ee/<Facebook user ID>.json
  e2eeDevicePath: process.env.FCA_E2EE_DEVICE_PATH
});

const api = await client.login(credentials);

// Establish/register the E2EE device and start its Noise connection.
await api.connectE2EE();

// Explicit E2EE send: failure rejects; it never falls back to plaintext.
await api.sendE2EEMessage("RECIPIENT_USER_ID", "Encrypted hello");

// Or require E2EE for a send through the standard sendMessage facade.
await api.sendMessage(
  { threadID: "RECIPIENT_USER_ID", message: "Encrypted hello" },
  { e2ee: "required" }
);

// For incoming E2EE events, use the ordinary listener after connectE2EE().
api.listenMqtt((error, event) => {
  if (error) return;
  if (event?.isE2EE) {
    // E2EE message or E2EE event
  }
});
\`\`\`

The example's \`createFacebookMqttDriver\` import is omitted for brevity; use the
transport provider configured by your application.

## Device-store security

Persistent E2EE identity keys, prekeys and ratchet sessions are sensitive. OmegA-FCA
requires an explicit 32-byte key (Buffer/Uint8Array) or 64-character hexadecimal key
for persistent storage. The file is AES-256-GCM encrypted and written with mode 0600.
The key can be supplied as \`e2eeStorageKey\`, or the configured SessionGuard key is
used as a fallback. Do not commit the key or the device-store file to Git.

If no key and no path are provided, the device store remains in memory only; the
device identity and sessions will not survive process restart. Supplying a path
without a key fails closed.

## Routing and plaintext safety

- \`sendE2EEMessage()\` and \`sendE2EEAttachment()\` always use the E2EE transport.
- \`sendMessage(input, { e2ee: "required" })\` requires E2EE and rejects on any E2EE error.
- \`sendMessage(input, { e2ee: false })\` explicitly selects the normal Messenger transport.
- Default \`auto\` mode routes to E2EE only for a thread already recorded as E2EE by the
  current E2EE device store. Otherwise it uses the existing MQTT/legacy path.
- Never use \`auto\` when the caller cannot establish whether a thread is E2EE. Use
  \`e2ee: "required"\` to fail closed.

## Live acceptance status

Synthetic cryptographic, media-integrity, storage-encryption and HTTP credential-routing
tests are included. The private Meta ICDC endpoints, Noise handshake, device registration,
and send/receive behavior still require live acceptance with an authorized Facebook
AppState. Do not treat synthetic tests as proof that Meta's current private endpoints
are unchanged.

## License

OmegA-FCA remains MIT. The E2EE source port is also MIT-licensed; see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the upstream copyright notice.
