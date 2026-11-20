# OmegA FCA Browser Capture

This owner-operated tool records HTTP/WebSocket metadata from a browser session for protocol research. It does not send captures to any server.

## Desktop setup

Node.js 20+ is required.

```sh
npm install --no-save playwright
npx playwright install chromium
npm run capture:browser
```

Sign in manually, open Messenger, and reproduce activity on an account you own. Press Ctrl+C to save `.omega-capture/capture-report.json`.

## Android / Termux

Termux cannot reliably launch Playwright's bundled desktop Chromium directly. On Android, use an installed Chromium-based browser with remote debugging enabled and attach over the Chrome DevTools Protocol (CDP). This is supported only if that browser exposes a CDP endpoint; Chrome's Android debugging is normally exposed through ADB. Browser builds such as Lemur may not expose a compatible endpoint.

1. Install Termux from a trusted source, then run:

```sh
pkg update && pkg upgrade
pkg install nodejs-lts android-tools
```

2. In the FCA repo:

```sh
npm ci
npm install --no-save playwright
```

3. Enable **Wireless debugging** in Android Developer options. In Termux, pair/connect using the IP and ports displayed by Android:

```sh
adb pair PHONE_IP:PAIR_PORT
adb connect PHONE_IP:DEBUG_PORT
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

4. Open Chrome on Android, keep it running, then check the debugging endpoint:

```sh
curl http://127.0.0.1:9222/json/version
```

If that endpoint responds with browser metadata, run:

```sh
npm run capture:browser -- --cdp http://127.0.0.1:9222
```

Log in and use Messenger in the already-open Android browser. The capture process attaches to that browser; it does not launch another one. If ADB pairing, the localabstract socket, or the endpoint is unavailable, that browser build/device does not expose CDP and this method will not work. Do not assume Lemur is compatible; verify its endpoint first.

## Capture privacy

The default report includes request method, origin/path (query strings omitted), response status/content type, WebSocket direction, frame size, and redacted text previews. It excludes HTTP bodies, cookie/header values, and browser storage.

For local binary protocol inspection only:

```sh
npm run capture:browser -- --cdp http://127.0.0.1:9222 --save-private-frames
```

Raw WebSocket frames are written to `.omega-capture/private/frames.ndjson` and may contain authentication material, identifiers, or private messages. Keep them on-device, never commit them, and never share them unredacted. The sanitized report is written to `.omega-capture/capture-report.json`.

## Limitations

- The browser and capture process run on the user's device; ChatGPT cannot see the live browser.
- CDP attachment requires a browser that explicitly exposes a compatible debugging endpoint.
- This tool does not bypass login, checkpoints, 2FA, rate limits, or platform security.
- Captures are evidence, not a protocol implementation. Native FCA behavior must be implemented only from reviewed, reproducible evidence.


## Import the signed-in browser session into encrypted storage

This is the owner-mediated authentication path for accounts that have completed login and any Facebook checkpoint/2FA in the official browser UI. It does not automate password entry, read passwords, bypass a challenge, or send credentials to a provider.

1. Open Facebook in your own browser and sign in normally. Complete any 2FA/checkpoint directly with Facebook.
2. Keep that browser profile open and attach CDP locally as described above. The browser must be the same profile that is signed in.
3. Create a local encryption key. Keep it in your shell/secret manager only; never commit it or paste it into chat:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

4. In the same local shell, set the key and run the importer:

```sh
export FCA_SESSION_KEY='YOUR_LOCALLY_GENERATED_64_HEX_CHAR_KEY'
export OMEGA_CDP_URL='http://127.0.0.1:9222'
export FCA_SESSION_FILE='./private/facebook-session.enc'
npm run import:browser-session
```

The importer reads only Facebook/Messenger cookies from the already-authenticated browser context, requires both `c_user` and `xs`, and writes them directly to an encrypted SessionGuard file plus a verified encrypted backup. It prints only the account ID, cookie count, and output paths—not cookie values. The encryption key must remain available to the bot at runtime as `FCA_SESSION_KEY`.

Then configure the native client with the same encrypted path and key, and call `client.login({ mode: "session" })`. The native driver revalidates the session with Facebook and checks the account identity before connecting MQTT. If Facebook expires the session, repeat the owner-operated browser sign-in/import flow.

**Android note:** use the Termux + ADB/CDP setup above first. The importer runs in Termux and attaches to the browser profile only if the CDP endpoint exposes that profile. Do not export cookies to clipboard, shell history, a file in Git, or a public service. Keep the encrypted file and its `.bak` beside private runtime data, outside the repository. Do not enable `--save-private-frames` for ordinary login/import.
