# Locker Secrets SDK for Node.js (`lockersm`)

This repository is the official TypeScript SDK wrapping the Locker CLI. It
publishes dual ESM/CommonJS artifacts.

## Required checks

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

Tests must not require live Locker credentials. A real CLI capability handshake
is enabled by setting `LOCKER_TEST_CLI_PATH`.

## Architecture

```text
Locker public API
  -> BinaryExecutor
  -> capability negotiation
  -> JSON-RPC request on stdin
  -> locker sdk
  -> strict response validation
  -> typed resource/error
```

- `src/locker.ts`: backward-compatible public API and local import/export.
- `src/cli/resolver.ts`: absolute explicit/env resolution and signed managed-cache verification
  of the canonical managed binary.
- `src/executors/binary.ts`: protocol framing, capabilities and response/error
  validation.
- `src/executors/process.ts`: bounded child process lifecycle and sanitized
  environment.
- `src/abstraction/`: public types and typed error hierarchy.
- `src/resources/`: stable protocol resource models.
- `src/utils/converter.ts`: strict required-field validation.
- `tests/conformance/`: protocol contract tests.

The canonical protocol document lives in the Locker CLI repository at
`docs/sdk-protocol-v1.md`.

## Protocol invariants

- Spawn the binary with exactly `['sdk']`.
- Credentials, headers, secret values and mutation data exist only in the JSON
  stdin body.
- Negotiate `system.capabilities` before the first vault operation.
- Require protocol name `locker.sdk`, version 1 and transport
  `json-rpc-2.0-stdio`.
- Parse stdout independently from stderr.
- Never log/store request bodies, response bodies or stderr.
- Bound timeout and all process buffers.
- Preserve numeric JSON-RPC error code, kind, retryability and request ID.
- Return a default only for code `-32004`.
- Ignore unknown response fields but validate every required field and type.

## Public API compatibility

Keep existing `Locker` method names and async/sync read pairs. Additive options
are acceptable. `getRequired` and `getRequiredSync` are the fail-closed APIs
used by scanner-generated code.

Canonical scanner helper:

```ts
import { Locker } from 'lockersm'

export const lockerClient = Locker.fromEnv()
```

Use `lockerClient.getRequiredSync('KEY')` for a replacement expression that
must remain valid outside async functions.

## TypeScript and packaging

- Strict TypeScript; avoid `any` except in the deprecated `LockerObj`
  compatibility helper retained for 1.x source compatibility.
- Source relative imports include `.js` so emitted ESM works in Node.
- `scripts/build.mjs` is cross-platform and emits `lib/esm` plus `lib/cjs`.
- Keep `src/version.ts` synchronized with `package.json`; tests enforce it.
- Node.js support floor is declared in `package.json`.

## Binary installation

- npm installation and module import never download a binary.
- Explicit `cliPath` and `LOCKER_CLI_PATH` have priority.
- First managed SDK use and `npx lockersm-install` use signed update-channel v2.
- `locker-cli-release.json` embeds the independent production Ed25519 public
  key; protected release CI must reject an empty or mismatched key.
- `scripts/install-cli.mjs` verifies signed latest/manifest metadata, exact
  platform selection, size/SHA-256/raw Ed25519 signatures, executable headers,
  timeouts, byte limits, an interprocess lock and atomic publication.
- Managed releases are immutable under `~/.locker/sdk-cli/nodejs/releases/2.x.y/` and an
  atomic pointer is switched only after full verification.
- Preserve the persisted 21,600-second check interval, anti-rollback and
  same-version equivocation checks. Never trust server-supplied keys.
