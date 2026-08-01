# Changelog

## 2.0.0 - Unreleased

- Adopt the stable `locker.sdk` JSON-RPC v1 protocol over stdin/stdout.
- Remove credentials, custom headers and secret values from child-process
  arguments and logs.
- Add capability negotiation, bounded process execution, cancellation,
  timeouts and typed protocol errors.
- Make `get` defaults apply only to `NOT_FOUND`; add fail-closed
  `getRequired` and `getRequiredSync`.
- Fix ESM packaging and make build/test scripts cross-platform.
- Replace disabled live-vault tests with deterministic protocol, API and
  package conformance suites.
- Replace pinned CLI versions with signed update-channel v2, an independent
  embedded Ed25519 trust root, first-use plus persisted six-hour checks, and
  fail-closed rollback/equivocation protection.
- Store fully verified CLI builds in immutable
  `~/.locker/sdk-cli/nodejs/releases/2.x.y/` directories and activate them through an
  atomic pointer; stop auto-selecting the unverified legacy `locker_secret`.
- Reject duplicate JSON fields, excessive nesting, invalid capability limits,
  malformed resource DTOs and runtime values that do not conform to protocol
  v1.
- Redact secret values from Node.js inspection/string output while keeping
  explicit `toJSON()`/export behavior available for intentional export.
- Add typed, bounded secret/environment page APIs and validate the CLI's
  advertised request/response/depth limits.
- Reject unpaired Unicode surrogates and non-finite request numbers, verify
  canonical signed release JSON and raw artifact signatures, and invalidate
  cached capabilities when the active binary identity changes.
- Require explicit CLI overrides to be absolute regular non-link files,
  validate executability on POSIX, document the exact cross-SDK credential
  alias precedence, and include the declared Apache-2.0 license text in
  published packages.
- Validate and normalize credentials before CLI resolution, and expose safe,
  kind-specific non-retryable authentication messages for missing, malformed,
  mismatched, and unauthorized credentials.

### Migration

- Upgrade the application runtime to supported Node.js LTS lines (22.20+ or
  24.x).
- Use the automatically resolved latest signed protocol-v1 Locker CLI, force a
  check with `npx lockersm-install`, or configure
  `cliPath`/`LOCKER_CLI_PATH`; npm installation itself never downloads or
  executes a CLI binary.
- Replace reliance on the legacy `locker_secret` auto-download with the
  canonical `locker` binary. Legacy paths are accepted only when explicitly
  configured and still must pass protocol capability negotiation.
- Handle typed authentication, permission, network, server, storage and
  protocol errors. `get`/`getSync` return their default only for `NOT_FOUND`;
  use `getRequired`/`getRequiredSync` for required configuration.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.6 - 2025-12-30

### Changed

- Update binary version to 1.0.106 to fix some bugs

## 1.2.5 - 2025-04-21

### Changed

- Update binary version to 1.0.101 to fix some bugs

## 1.2.4 - 2025-01-23

### Added

- Use `import(source)` to import secrets from `.env` or `.ini` files
- Add interfaces, types, and enums to export

### Changed

- Update binary version to 1.0.100 to fix migration error

### Fixed

- `LogLevel.NONE` not working when init `Locker` object

## 1.2.3 - 2024-10-30

### Changed

- New project name & home! Now it's `lockersm`

## 1.2.2 - 2024-10-10

### Changed

- Update binary version to 1.0.98 to support linux-arm64 system

## 1.2.1 - 2024-08-14

### Changed

- Update binary version to 1.0.94

## 1.2.0 - 2024-06-06

### Added

- Add `env` parameter to `list` and `listSync` to list secrets by environment
- Add `cacheOptions` to Locker's constructor to config object-level caching strategy
- Add `config` parameter to all methods, allowing method-level caching strategy configuration
- Add an `export` method thats allow exporting secrets into env/json/txt file

### Changed

- Update binary version to 1.0.91
- Update test cases

## 1.1.2 - 2024-05-02

### Fixed

- Cannot replace the binary file during update due to lack of `WRITE` permission

### Changed

- To get or retrieve a secret from `ALL` environment, set the second parameter to `undefined`. Example: `locker.get('key', undefined, 'default-value')`
- Set `environmentName` to `''` when using `modify` to set the secret's env to `ALL`
- Change binary command data and format
- Update binary version to 1.0.88

## 1.1.1 - 2024-03-22

### Changed

- Update binary version to 1.0.82

## 1.1.0 - 2024-03-01

### Added

- Use `retrieve(key, env)` or `retrieveSync(key, env)` to get full Secret object

### Changed

- Separate folder for spec tests
- Update binary version to 1.0.81

## 1.0.2 - 2024-01-30

### Changed

- New project name & home! Now it's `@lockerpm/secrets`
- Update binary version to 1.0.73
