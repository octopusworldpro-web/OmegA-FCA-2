# TypeScript API and package exports

OmegA-FCA is a CommonJS package with a single public package entry point. The package metadata maps:

- Runtime: `main: index.js`
- Type declarations: `types: index.d.ts`
- Conditional package exports: `.` → `require/default: ./index.js`, `types: ./index.d.ts`
- Supported Node.js: 20+

## Installation

```sh
npm install @nirzon-islam/omega-fca
npm install --save-dev @types/node
```

The Node.js type definitions are needed by TypeScript consumers because public signatures expose Node's `Buffer` type. The package does not install TypeScript or `@types/node` into an application automatically.

## Typed bot example

```ts
import { createMessengerBot, type Cookie, type MessengerBotContext } from "@nirzon-islam/omega-fca";

const appState: Cookie[] = loadYourAuthorizedAppState();
const bot = await createMessengerBot({ mode: "appstate", appState });

bot.command("ping", async (ctx: MessengerBotContext) => {
  await ctx.replyAsync("pong");
});

bot.launch();
```

## Export contract

`index.d.ts` is the declaration entry point for the values exposed by `index.js`. The test suite checks that every enumerable runtime root export has a corresponding public value declaration. It also checks that `package.json` points to the shipped declaration file. This is a static declaration-contract test, not a TypeScript compiler run.

The `MessengerBot` constructor and `createMessengerPinMessageRequest()` helper are included in the public declarations. Types and interfaces are not runtime exports and are not expected to appear as JavaScript properties.

## Verification

Run:

```sh
npm test
npm run test:types
npm run test:syntax
npm pack --dry-run
```

CI runs the test suite, the explicit declaration-contract test, syntax checks, root-export smoke checks and package-content verification on Node.js 20 and 22.

## Compatibility and limitations

- The package remains CommonJS; the declarations describe the CommonJS root entry point.
- Facebook private endpoints, MQTT protocol operations and Messenger E2EE actions remain subject to authorized live-account acceptance.
- A declared method means it is part of the documented package surface; it does not mean the corresponding private Facebook endpoint is stable or live-verified.
- Node.js 20+ is required. No claim of browser or edge-runtime support is made.
