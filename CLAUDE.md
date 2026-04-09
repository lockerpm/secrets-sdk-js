# Locker Secrets SDK for Node.js (lockersm)

TypeScript SDK wrapping the Locker CLI binary for secret and environment management. Supports dual CommonJS/ESM builds.

## Build & Test

```bash
npm install          # Installs deps + runs setup.js to download platform CLI binary
npm run build        # Full rebuild: cleans lib/, compiles ESM + CJS
npm test             # Mocha tests (requires .env with valid Locker credentials)
```

Most tests need a `.env` file — copy `.env.example` and fill in credentials. The `.mocharc.js` currently ignores `tests/basic/`, `tests/others/`, and `tests/example/`; enable them by removing the `ignore` entries when credentials are available.

## Architecture

```
Locker class → BinaryExecutor → locker-cli binary → JSON → Converter → typed objects
```

- **`src/locker.ts`** — Main SDK class. All public API methods live here.
- **`src/executors/binary.ts`** — Wraps platform-specific CLI via `execFile`/`execFileSync`. Handles platform detection (macOS/Windows/Linux, x64/arm64).
- **`src/abstraction/executor.ts`** — Command type system: `Target` enum (ENVIRONMENT/SECRET), `Action` enum (CREATE/GET/LIST/UPDATE/IMPORT), typed `CommandData`.
- **`src/resources/`** — `Secret` and `Environment` resource classes, both extending `LockerObj`.
- **`src/utils/converter.ts`** — Parses CLI JSON output into typed resource objects.
- **`setup.js`** — Post-install: downloads versioned CLI binary. Update `CLI_VERSION` here when upgrading the binary.

## Code Conventions

### Async/Sync pattern
Every public method has both variants:
```typescript
list(options?): Promise<Secret[]>
listSync(options?): Secret[]
```
Use `_execute()` for async, `_executeSync()` for sync inside `Locker`.

### TypeScript
- Strict mode is on — no implicit `any`, no loose types.
- Define methods in the `ILockerSecret` interface first, then implement in `Locker`.
- Resource classes implement their typed interface (`ISecret`, `IEnvironment`) and extend `LockerObj`.
- `LockerObj` stores raw API data in `_raw`; use `getValueOrDefault()` for field access.

### Naming
- SDK parameters: camelCase (e.g., `outputFile`)
- API/CLI flags: snake_case/kebab-case — auto-converted via `camelToFlag()` in `src/utils/helpers.ts` (e.g., `outputFile` → `--output-file`)

### Formatting
- No semicolons, single quotes (Prettier config in `.prettierrc`)
- No ESLint — TypeScript strict mode serves as the linter

## Adding New Operations

1. Add method signatures (async + sync) to `ILockerSecret` in `src/abstraction/index.ts`
2. Add `Target` and/or `Action` enum values in `src/abstraction/executor.ts` if needed
3. Implement both methods in `src/locker.ts` using `_execute()` / `_executeSync()`
4. Add test in `tests/basic/` covering both variants

## Adding New Resource Types

1. Extend `LockerObj` base class
2. Define a typed interface (e.g., `ISecret`)
3. Add a converter method in `src/utils/converter.ts`
4. Export from `src/abstraction/index.ts` and `src/resources/index.ts`

## Dual-Format Build

| Format | Config | Output |
|--------|--------|--------|
| ESM | `configs/tsconfig.esm.json` | `lib/esm/index.mjs` |
| CJS | `configs/tsconfig.cjs.json` | `lib/cjs/index.js` |

Type declarations go to `lib/esm/types/` and `lib/cjs/types/`. Package conditional exports in `package.json` route consumers automatically.

## Logging

Use the `Logger` class with configurable levels: `NONE=0`, `ERROR=1`, `DEBUG=2`. Debug level logs raw CLI commands and outputs — useful during development.

## Binary Management

The CLI binary lives in `bin/` (git-ignored). `setup.js` downloads the correct platform binary on `postinstall`. Version is controlled by `CLI_VERSION` in `setup.js`. Binary filename pattern: `locker_secret` (Linux/macOS) / `locker_secret.exe` (Windows).
