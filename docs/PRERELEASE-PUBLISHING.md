# OmegA-FCA prerelease publishing

The repository is prepared for a public npm prerelease. Publishing is intentionally an owner-operated step; CI never publishes and no npm credential is stored in this repository.

## Current prerelease candidate

- Package: `@nirzon-islam/omega-fca`
- Candidate version: `0.1.6-rc.3`
- Registry: `https://registry.npmjs.org/`
- Dist-tag: `next` (configured in `publishConfig`; do not move the stable `latest` tag)

## Before publishing

Run from the repository root on the verified `main` commit:

```sh
npm ci
npm test
npm run test:types
npm run test:syntax
npm pack --dry-run --json
```

Review the package file list and ensure no AppState, cookies, session keys, local environment files, or test credentials are included.

## Owner-operated publish

After the GitHub Actions run for the exact commit is green and the package contents have been reviewed:

```sh
npm publish --access public --tag next
```

The npm account must have publish permission and complete any required two-factor authentication. Do not put an npm token or OTP in GitHub source, chat, logs, or commits.

## Verify the published artifact

```sh
npm view @nirzon-islam/omega-fca@next version
npm view @nirzon-islam/omega-fca dist-tags
npm pack @nirzon-islam/omega-fca@next
```

Confirm that `next` resolves to the intended candidate version and inspect the packed tarball. Only after that should GoatBot's `fca-migration-cleanup` dependency and lockfile be updated to the exact published version and tested with `npm ci`.

## Release boundary

A successful package build and synthetic CI do not prove Facebook login, MQTT event delivery, message sending, attachments, or private web actions work against Meta's live service. Those still require an authorized owner-controlled AppState acceptance run.