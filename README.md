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

1. Constructor `cliPath`
2. `LOCKER_CLI_PATH`
3. The latest fully verified managed release

Every managed capability and vault-operation spawn revalidates the local trust
root, canonical pointer, signed manifest, private generation, executable
header, exact size, and SHA-256 immediately before execution. Artifact bytes
are streamed through a fixed 64 KiB buffer, so this safety check has bounded
memory use. A newly selected generation additionally receives full detached
Ed25519 artifact verification before adoption. Async calls reuse the already
loaded verifier module and abort its read with the operation budget; sync calls
use the bounded bundled helper. Neither path performs a network check unless
the normal update deadline is due. In-place replacement with the same path,
size, and modification time therefore fails closed. Explicit caller-owned CLI
paths retain their existing trust semantics and skip managed-channel
verification.

On POSIX, every managed cache ancestor must be owned by the effective user and
is revalidated at mode `0700` before updater state is used.

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

| Environment variable       | Purpose                           |
| -------------------------- | --------------------------------- |
| `LOCKER_ACCESS_KEY_ID`     | Project access key ID             |
| `LOCKER_SECRET_ACCESS_KEY` | Project secret access key         |
| `LOCKER_API_BASE`          | Cloud or self-hosted API base URL |
| `LOCKER_CLI_PATH`          | Absolute caller-owned CLI path    |

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
support a bounded timeout and detect an already-aborted signal. A call uses one
total timeout budget across capability negotiation and the vault operation;
each subprocess receives only the remaining time.
On Windows, tree termination resolves the OS `taskkill.exe` through the kernel
`SystemRoot` device path; ambient `PATH`, `SystemRoot`, and `WINDIR` values
cannot substitute an executable.
`maxBufferBytes` may lower the 20 MiB protocol response ceiling but cannot
raise it. Cached capabilities are discarded when a file-backed CLI identity
changes.

The SDK does not automatically retry a vault RPC. Create and update are sent
once because a lost response can leave the remote commit outcome unknown.
Applications may inspect `error.retryable` and add bounded retry only around
read-only operations.

`restTime` controls the CLI's encrypted, revision-aware vault cache; the SDK
does not retain plaintext secret values. `restTime: 0` disables offline reuse,
and `fetch: true` requires a successful server refresh with no cache fallback.
A transient outage may reuse only a still-fresh cache last validated
successfully by the server. Authentication, authorization, TLS, integrity,
malformed-response, and local-storage failures fail closed.

## Error handling

Protocol errors retain the JSON-RPC code, Locker kind, retryability and request
ID:

```ts
import {
  LockerAlreadyExistsError,
  LockerAuthenticationError,
  LockerConflictError,
  LockerNotFoundError,
  LockerRateLimitError,
  LockerTransportError,
} from 'lockersm'

try {
  await locker.create({
    key: 'PAYMENT_API_KEY',
    value: paymentApiKey,
  })
} catch (error) {
  if (error instanceof LockerAlreadyExistsError) {
    // PAYMENT_API_KEY already exists.
    // This is also a LockerConflictError.
  } else if (error instanceof LockerNotFoundError) {
    // Secret does not exist.
  } else if (error instanceof LockerAuthenticationError) {
    // Credentials are invalid or revoked.
  } else if (error instanceof LockerRateLimitError && error.retryable) {
    // retryAfterSeconds is an optional validated 0..86400 hint.
  } else if (error instanceof LockerTransportError) {
    // The CLI process did not complete a valid protocol exchange.
  }
}
```

| Protocol code | JavaScript error                                   | Canonical kind                                                           |
| ------------: | -------------------------------------------------- | ------------------------------------------------------------------------ |
|      `-32700` | `LockerProtocolError`                              | `parse_error`                                                            |
|      `-32600` | `LockerProtocolError`                              | `invalid_request`                                                        |
|      `-32601` | `LockerProtocolError`                              | `method_not_found`                                                       |
|      `-32602` | `LockerProtocolError`                              | `invalid_params`                                                         |
|      `-32603` | `LockerProtocolError`                              | `internal_protocol_error`                                                |
|      `-32000` | `LockerError` and legacy subtypes                  | `operation_error`, `request_rejected`, `response_too_large`, `cancelled` |
|      `-32001` | `LockerAuthenticationError`                        | `unauthorized`; legacy `invalid_secret_access_key`                       |
|      `-32003` | `LockerPermissionError`                            | `forbidden`; legacy `permission_denied`                                  |
|      `-32004` | `LockerNotFoundError`                              | `secret_not_found`, `environment_not_found`; legacy not-found aliases    |
|      `-32009` | `LockerConflictError` / `LockerAlreadyExistsError` | `conflict`, `secret_already_exists`, `environment_already_exists`        |
|      `-32022` | `LockerValidationError`                            | `validation_error`                                                       |
|      `-32029` | `LockerRateLimitError`                             | `rate_limited`                                                           |
|      `-32050` | `LockerNetworkError`                               | `network_error`, `network_timeout`; legacy `http_error`                  |
|      `-32051` | `LockerServerError`                                | `service_unavailable`, `internal_error`; legacy `server_error`           |
|      `-32060` | `LockerStorageError`                               | `database_error`, `file_error`, `path_error`                             |
|      `-32070` | `LockerIntegrityError`                             | integrity, transport-integrity, and data-integrity kinds                 |

Classification is numeric-first. Distinctive kinds from older CLI releases
(`duplicate_hash`, `*_already_exists`, `conflict`, `validation_error`, and
the integrity aliases) are also mapped when their legacy code is `-32000`.
`request_rejected`, `response_too_large`, and `cancelled` have explicit
subtypes but are never guessed to be conflicts. All `-32000` errors and known
authentication, permission, not-found, conflict, validation, storage,
integrity, protocol, cancellation, and internal-server errors expose
`retryable === false`. Only rate-limit, network, service-unavailable, or an
unknown server-range code can preserve a true hint. The SDK never replays a
vault RPC automatically.

The SDK opts into typed errors only after `system.capabilities` advertises the
exact `typed-v1` value in `error_contracts`; absent and unknown valid
contracts remain compatible and are not sent in operation context.
`serverRequestId` is a separately validated upstream correlation ID. It never
replaces the local JSON-RPC `requestId` and is not included in default error
text.

Error objects and logs never retain protocol bodies, raw CLI messages, or CLI
output. Upgrade the CLI to receive the unambiguous numeric codes above.

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

CI tests reviewed digests of the official Node.js 22 and 24 LTS Bookworm
images. Their buildpack-deps base supplies Git for the history-backed release
policy; the smaller development Dockerfile remains on Node.js 24 LTS Alpine.
`npm ci --ignore-scripts` consumes the committed SHA-512-integrity lock without
executing dependency lifecycle code. Node.js 18 and 20 are end-of-life and
odd-numbered releases are not accepted by SDK 2.0.

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

Every accepted two-parent merge into protected `main` automatically publishes
one stable patch release. CI derives the version from first-parent history,
rejects direct/squash/rebase commits and mispointed base tags, and waits for
the immediate predecessor tag to resolve to the current merge's first parent.
Configure the `lockersm-npm` resource group once with process mode
`oldest_first`; it serializes release jobs without occupying every runner,
while the predecessor check remains a fail-closed second ordering layer. CI
injects the version only into an isolated tracked-source copy, then builds,
type-checks, packs and smoke-tests both CommonJS and ESM imports. Publication
is idempotent: an existing npm version is accepted only when its SHA-512
integrity exactly matches the locally verified tarball.

This project uses self-managed GitLab and runners, so npm trusted publishing
for GitLab.com shared runners is not available. Configure `NPM_TOKEN` as a
protected masked npm granular access token scoped only to the `lockersm`
package, with read/write permission and bypass-2FA enabled for CI. Give it the
shortest practical expiry and restrict it to the runners' fixed egress IP
ranges when npm account policy supports that control; do not use a legacy
token. Also configure protected `LOCKER_CLI_RELEASE_PUBLIC_KEY` as the
canonical unpadded base64url raw 32-byte value that must independently match
the reviewed key in `locker-cli-release.json`; CI never derives the protected
value from the packaged resource. Protect `main`, `v*`, and the `npm`
environment.
Reject `[ci skip]` and `[skip ci]` on `main`, and prevent the `ci.skip` or
`ci.no_pipeline` push options where the GitLab tier supports pipeline
execution policies.
Do not merge the next change until the preceding release succeeds. A missing
predecessor intentionally blocks later versions; recover and verify that exact
failed release rather than bypassing or synthesizing a later tag.

After the first pipeline creates the resource group, a Maintainer must run:

```shell
curl --request PUT \
  --header "PRIVATE-TOKEN: <maintainer-token>" \
  --data "process_mode=oldest_first" \
  "https://git.cystack.org/api/v4/projects/<project-id>/resource_groups/lockersm-npm"
```

## Security

Report security issues privately to <contact@locker.io>. Do not include access
keys or plaintext secrets in issue trackers.
Product help is available at [support.locker.io](https://support.locker.io).

## Troubleshooting

- Authentication/permission errors: verify the canonical credential pair and
  its project/environment scope.
- `LockerTransportError`: check the API base, CA/proxy, timeout, and absolute
  CLI path; protocol bodies and CLI stderr are intentionally unavailable.
- Managed install failure: check system time, HTTPS access to
  `files.locker.io`, and private ownership below
  `~/.locker/sdk-cli/nodejs`.
- Protocol failure: upgrade the SDK and CLI together or remove an incompatible
  explicit `LOCKER_CLI_PATH`.
- Unexpected stale reads: use `fetch: true`; do not loosen cache permissions.

## License

Apache-2.0
