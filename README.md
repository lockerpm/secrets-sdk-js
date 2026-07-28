# Locker Secrets SDK for Node.js

The official Node.js SDK for Locker Passwords & Secrets Management. It uses
the versioned `locker.sdk` protocol exposed by the Locker CLI and supports both
ES modules and CommonJS.

## Requirements

- Node.js 22.20+ or Node.js 24 LTS
- A Locker access key
- A compatible Locker CLI binary

Installing or importing the npm package never performs a network download.
An explicit absolute, regular, non-link CLI path through `cliPath` or
`LOCKER_CLI_PATH` always bypasses managed updates. Bare and relative values
are rejected instead of being searched through ambient `PATH`. Otherwise, the
first SDK client use checks the signed stable channel and persists a six-hour
check interval. You can also force a check:

```bash
npx lockersm-install
```

The SDK embeds the reviewed Ed25519 production public trust root.
The updater verifies signed `latest.json`, the SHA-256-bound signed manifest,
the selected artifact's size/SHA-256/raw Ed25519 signature, and its executable
OS/architecture header. Releases are immutable under
`~/.locker/sdk-cli/nodejs/releases/2.x.y/`; an atomic local pointer activates a fully
verified release. Resolution order is:

On POSIX, every managed cache ancestor must be owned by the effective user and
is revalidated at mode `0700` before updater state is used.

1. Constructor `cliPath`
2. `LOCKER_CLI_PATH`
3. The latest fully verified managed release

The legacy auto-downloaded `locker_secret` binary is never selected
automatically because it has no protocol-v1 provenance. During migration it
can only be selected explicitly; capability negotiation still rejects a
binary that does not implement the required protocol.

## Installation

```bash
npm install lockersm
```

## Migrating from 1.x

Version 2 requires a supported Node.js LTS line (22.20+ or 24.x) and a Locker
CLI that exposes protocol v1.
Package installation no longer runs a postinstall downloader. Let the first
SDK use resolve the latest signed CLI, run `npx lockersm-install`, or set
`cliPath` / `LOCKER_CLI_PATH` to a trusted CLI. The legacy `locker_secret`
binary is not auto-selected.

`get` and `getSync` now return a default only for `NOT_FOUND`; other failures
raise typed errors. Use `getRequired` or `getRequiredSync` wherever a missing
secret must stop application startup.

## Configuration

Use the canonical Locker environment variables:

```text
LOCKER_ACCESS_KEY_ID
LOCKER_SECRET_ACCESS_KEY
```

Migration lookup uses this fixed precedence: `LOCKER_ACCESS_KEY_ID` then
`ACCESS_KEY_ID`, and `LOCKER_SECRET_ACCESS_KEY` then `SECRET_ACCESS_KEY`, then
`LOCKER_ACCESS_KEY_SECRET`, then `ACCESS_KEY_SECRET`.

```ts
import { Locker } from 'lockersm'

const locker = Locker.fromEnv()
```

An explicit configuration is also supported:

```ts
const locker = new Locker({
  accessKeyId: process.env.LOCKER_ACCESS_KEY_ID!,
  secretAccessKey: process.env.LOCKER_SECRET_ACCESS_KEY!,
  apiBase: 'https://api.locker.io/locker_secrets',
  cliPath: process.env.LOCKER_CLI_PATH,
  timeoutMs: 30_000,
})
```

Credentials, headers and secret values are serialized into one JSON request
on the CLI's stdin. The child process receives only one argument: `sdk`.

## Reading secrets

```ts
const value = await locker.get('DATABASE_PASSWORD', 'production')
const syncValue = locker.getSync('DATABASE_PASSWORD', 'production')
```

`get` and `getSync` return `undefined` or the supplied default only when Locker
returns `NOT_FOUND`. Authentication, permission, network, storage and protocol
errors are never converted into a default.

For configuration that must exist, use the fail-closed accessors:

```ts
const value = await locker.getRequired('DATABASE_PASSWORD', 'production')
const syncValue = locker.getRequiredSync('DATABASE_PASSWORD', 'production')
```

Retrieve the full typed resource or list resources:

```ts
const secret = await locker.retrieve('DATABASE_PASSWORD', 'production')
const secrets = await locker.list('production')
const environments = await locker.listEnvironments()
```

Every read operation also has the existing synchronous variant.
Node.js inspection and `Secret#toString()` redact the value. Explicit
`Secret#toJSON()` and SDK export methods include plaintext by design, so their
results must be handled as sensitive data.

For large collections, use the bounded page APIs and continue until
`nextCursor` is `null`:

```ts
let cursor: string | undefined
do {
  const page = await locker.listPage({ pageSize: 100, cursor }, 'production')
  for (const secret of page.items) {
    useSecret(secret)
  }
  cursor = page.nextCursor ?? undefined
} while (cursor !== undefined)
```

`listEnvironmentsPage`, `listPageSync`, and
`listEnvironmentsPageSync` use the same opaque cursor contract.

## Creating and updating

```ts
await locker.create({
  key: 'DATABASE_PASSWORD',
  value: 'secret value',
  environmentName: 'production',
  description: 'Primary database password',
})

await locker.modify('DATABASE_PASSWORD', 'production', {
  newKey: 'PRIMARY_DATABASE_PASSWORD',
  value: 'new value',
  environmentName: null, // clear the environment association
  description: '',
})

await locker.createEnvironment({
  name: 'production',
  externalUrl: 'https://example.com',
})

await locker.modifyEnvironment('production', {
  newName: 'production-eu',
  externalUrl: 'https://eu.example.com',
})
```

## Cache, timeout and cancellation

Cache settings can be configured globally or per call. Per-call values,
including `false` and `0`, override the global defaults.

```ts
const controller = new AbortController()

const secrets = await locker.list(undefined, {
  fetch: true,
  restTime: 0,
  timeoutMs: 5_000,
  signal: controller.signal,
})

controller.abort()
```

The SDK bounds request, stdout and stderr sizes and terminates the CLI process
tree when an asynchronous call times out or is cancelled. Synchronous calls
support a bounded timeout and detect an already-aborted signal.
On Windows, tree termination resolves the OS `taskkill.exe` through the kernel
`SystemRoot` device path; ambient `PATH`, `SystemRoot`, and `WINDIR` values
cannot substitute an executable.
`maxBufferBytes` may lower the 20 MiB protocol response ceiling but cannot
raise it. Cached capabilities are discarded when a file-backed CLI identity
changes.

## Error handling

Protocol errors retain the JSON-RPC code, Locker kind, retryability and request
ID:

```ts
import {
  LockerAuthenticationError,
  LockerNotFoundError,
  LockerRateLimitError,
  LockerTransportError,
} from 'lockersm'

try {
  await locker.getRequired('DATABASE_PASSWORD')
} catch (error) {
  if (error instanceof LockerNotFoundError) {
    // Secret does not exist.
  } else if (error instanceof LockerAuthenticationError) {
    // Credentials are invalid or revoked.
  } else if (error instanceof LockerRateLimitError && error.retryable) {
    // Retry with backoff.
  } else if (error instanceof LockerTransportError) {
    // The CLI process did not complete a valid protocol exchange.
  }
}
```

Error objects and logs never retain protocol bodies or CLI output.

## Import and export

The compatibility `import` and `export` APIs remain available. File parsing and
formatting happen inside the SDK; every vault operation still uses protocol v1.

```ts
await locker.import('.env.production')

await locker.export({
  outputFile: '.env.production',
  format: 'env',
  env: 'production',
})
```

Import accepts dotenv assignments and INI-style environment sections. Export
supports `txt`, `env` and `json`.

## Development

```bash
npm ci --ignore-scripts
npm run ci:contract
npm audit --audit-level=high
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

CI tests the reviewed digests of the official Node.js 22 and 24 LTS images;
the development Dockerfile uses Node.js 24 LTS. `npm ci --ignore-scripts`
consumes the committed SHA-512-integrity lock without executing dependency
lifecycle code. Node.js 18 and 20 are end-of-life and odd-numbered releases
are not accepted by SDK 2.0.

`npm test` builds both module formats, runs protocol conformance tests, API
tests and package import smoke tests. To include the real CLI handshake test:

```bash
LOCKER_TEST_CLI_PATH=/path/to/locker npm test
```

The managed updater implements signed update-channel v2 at
`https://files.locker.io/cli/releases/`. It performs a first-use check and then checks
at most once per persisted 21,600-second interval. Signed metadata prevents
rollback and same-version mutation; redirects, unknown fields, duplicate JSON
keys, non-canonical encodings, wrong hashes/signatures and wrong executable
headers fail closed. Only an actual transport failure may reuse a previously
and fully reverified cache.

Tagged release verification requires the independently protected
`LOCKER_CLI_RELEASE_PUBLIC_KEY` CI variable. Its canonical unpadded base64url
raw 32-byte value must match the reviewed key in `locker-cli-release.json`;
CI never derives the protected value from that packaged resource.

## Security

Report security issues privately to <contact@locker.io>. Do not include access
keys or plaintext secrets in issue trackers.

## License

Apache-2.0
