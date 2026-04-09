# Locker Secret NodeJS SDK

TypeScript SDK wrapping the Locker CLI binary for secret management. Supports dual CommonJS/ESM builds.

## Code Style

- **TypeScript**: Strict typing via interfaces (`ILockerSecret`, `ISecret`, `IEnvironment`)
- **Async/Sync pattern**: Every public method has both variants (`list()` / `listSync()`, `get()` / `getSync()`)
- **Resource classes**: Extend `LockerObj` base class for dynamic hydration from API responses
- **Naming**: camelCase in SDK, snake_case from API (auto-converted via `Converter`)

See [src/locker.ts](../src/locker.ts) for method patterns, [src/resources/secret.ts](../src/resources/secret.ts) for resource examples.

## Architecture

**Binary Executor Pattern**: SDK calls → CLI command parameters → platform-specific binary execution

```
Locker class → BinaryExecutor → locker-cli binary → API responses → Converter → typed objects
```

- **Executor Layer** ([src/executors/binary.ts](../src/executors/binary.ts)): Wraps CLI via `execFile`/`execFileSync`, handles platform detection
- **Command Model** ([src/abstraction/executor.ts](../src/abstraction/executor.ts)): `Target` (ENVIRONMENT/SECRET) + `Action` (CREATE/GET/LIST/UPDATE) + typed `CommandData`
- **Resource Hydration**: API responses stored in `_raw`, accessed via `getValueOrDefault()` for type safety

**Binary Management**: [setup.js](../setup.js) downloads platform-specific CLI (v1.0.106) during `postinstall`. Update `CLI_VERSION` when upgrading.

## Build and Test

```bash
npm install          # Auto-runs setup.js to download binary
npm run build        # Full rebuild: ESM + CJS
npm run test         # Run Mocha tests (requires .env with credentials)
```

**Dual-format build**:

- ESM: `configs/tsconfig.esm.json` → `lib/esm/index.mjs`
- CJS: `configs/tsconfig.cjs.json` → `lib/cjs/index.js`
- Package exports handle conditional imports

**Testing**: Mocha with Chai. See [tests/basic/](../tests/basic/) for operation examples, [tests/mocks/](../tests/mocks/) for test setup. Most tests require Locker API credentials in `.env`.

## Conventions

**Adding new operations**:

1. Define method in `ILockerSecret` interface (both async and sync)
2. Implement in `Locker` class using `_execute()` / `_executeSync()`
3. Add `Target`/`Action` enum values if needed
4. Create test in `tests/basic/` with both variants

**Adding new resource types**:

1. Extend `LockerObj` base class
2. Define typed interface (e.g., `ISecret`)
3. Add converter method in `Converter` class
4. Export from [src/abstraction/index.ts](../src/abstraction/index.ts)

**Parameter conversion**: `camelToFlag()` in [src/utils/helpers.ts](../src/utils/helpers.ts) converts SDK params to CLI flags. Follow existing patterns (e.g., `outputFile` → `--output-file`).

**Logging**: Use `Logger` class with configurable levels (NONE=0, ERROR=1, DEBUG=2). Debug logs show raw CLI commands and outputs.

## Key Files

- [src/locker.ts](../src/locker.ts): Main SDK class with all public methods
- [src/executors/binary.ts](../src/executors/binary.ts): Binary execution logic
- [src/abstraction/executor.ts](../src/abstraction/executor.ts): Command type system
- [setup.js](../setup.js): CLI binary download and platform detection
- [package.json](../package.json): Dual export configuration
