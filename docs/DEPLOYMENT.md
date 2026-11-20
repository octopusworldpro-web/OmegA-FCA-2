# Deployment and AppState test checklist

OmegA-FCA is a **Node.js library**, not a standalone web server. For the current testing phase, use the AppState session-validation smoke test. Do not deploy the Meta Page webhook example for personal-account testing.

## Current test scope

The AppState smoke test validates an owner-supplied Facebook session over HTTPS and reports the account ID, session state, and validation time. It does **not** establish the private Messenger realtime connection, subscribe to events, send messages, or make this package a drop-in GoatBot FCA replacement.

Native email/password login is intentionally deferred. The test runner rejects credential mode and only accepts cookie/AppState data. The native driver can optionally persist an encrypted AppState snapshot after MQTT setup when an explicit session-guard key is configured; a later process can use `client.login({ mode: "session" })` to restore, revalidate and reconnect from that encrypted snapshot.

## Requirements

- Node.js 20 or 22.
- The repository checked out on `public-package`.
- A valid, owner-controlled AppState/cookie export.
- Network access to Facebook over HTTPS.

## Prepare the AppState file

Put only the cookie/AppState data in the project-root `account.txt`. Accepted formats are:
- Raw cookie header (`c_user=...; xs=...`).
- Netscape cookie export.
- JSON cookie array.

Alternatively, put a JSON cookie array in `appstate.json`.

Do not put email, username, password, 2FA seed/code, or tokens in `account.txt`. Do not commit either file. Both are ignored by `.gitignore`.

## Run the smoke test

From the OmegA-FCA repository root:

~~~bash
npm ci
npm test
npm run test:syntax
npm run test:appstate
~~~

The AppState test command is a live network check and is intentionally **not** part of CI. It prints only the Facebook user ID, session state, timestamp, and a safe error summary; it never prints cookie values.

If the package is installed inside a GoatBot project and the account file is in the GoatBot project root, run the example from that project root:

~~~bash
node node_modules/@omega/fca/examples/appstate-session-check.js
~~~

This command validates the AppState session layer only. It does not prove that GoatBot can receive Messenger events through OmegA-FCA.

## Optional encrypted session persistence

When using `createFacebookMqttClient()`, pass `sessionGuard: { filePath, key, intervalMs }` to enable automatic encrypted AppState snapshots after a successful MQTT connection. Use a private writable volume/path for `filePath` and provide `key` from a secret manager or environment variable (64 hexadecimal characters or a 32-byte Buffer). Do not commit the key or encrypted session files. The driver creates a verified backup and attempts a final save on logout. This does not replace the original login credential or remove the need for the owner to refresh an expired Facebook session.\n\nFor an existing GoatBot deployment that already calls `api.sessionGuard(account.txt, options)`, FCA also accepts these optional environment variables without changing GoatBot source or its existing config:\n\n~~~bash\nFCA_SESSION_FILE=./private/facebook-session.enc\nFCA_SESSION_KEY=<64-hex-character-owner-generated-key>\nFCA_SESSION_INTERVAL_MS=180000\n~~~\n\nThe legacy `account.txt` argument is treated only as an activation alias. Encrypted data is stored at `FCA_SESSION_FILE` (and its `.bak` backup), never in `account.txt`. Keep the key in Railway/Render secret environment settings and ensure the encrypted file path is on a private persistent volume. If the optional variables are absent, the encrypted guard remains disabled; the existing plaintext AppState workflow continues unchanged.

## Railway / Render notes

For this phase, deploy the **existing GoatBot application** with its currently working FCA dependency unchanged. Keep its `account.txt` as a private runtime file/volume or use the bot's existing secure session mechanism. Do not bake AppState into the image, commit it, print it in logs, or place it in a public build artifact.

OmegA-FCA can be installed as a package dependency only after the owner deliberately configures access to the private GitHub repository. Do not replace GoatBot's current FCA dependency yet: the full transport and API compatibility gates are not complete.

## Release / CI checks

The repository CI is intended to run on Node 20 and 22 and performs:
1. `npm ci`
2. `npm test`
3. Recursive JavaScript syntax validation.
4. Root package export smoke test.
5. `npm pack --dry-run --json`.

`prepublishOnly` repeats unit tests and syntax validation before npm publishing. This branch is not being published as an npm package during the AppState test phase.

## Not yet deploy-ready as a standalone personal FCA

These remain hard blockers for replacing the existing GoatBot FCA:
- Native email/password login (deferred by current project decision).
- A complete personal-account action/API layer.
- Messenger realtime transport, subscriptions, acknowledgements, and event decoding.
- Full legacy FCA method/event parity and GoatBot call-site coverage.
- Authorized end-to-end tests for message receive/send, groups, reconnect, and session expiry.

Do not point the live GoatBot deployment at OmegA-FCA as a drop-in replacement until those gates pass.

## Separate Page webhook example

The repository also contains an official Meta Messenger **Page** webhook example. It is unrelated to personal-profile AppState testing and requires a Page token, Meta app configuration, webhook verification, and separate deployment settings. Do not use it for this task.
