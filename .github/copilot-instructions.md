# Locker Secrets SDK for Node.js

Follow [CLAUDE.md](../CLAUDE.md) for repository architecture and required
checks.

The only supported SDK/CLI boundary is JSON-RPC protocol v1 through
`locker sdk`. Never add human CLI flags, credentials, headers, secret values,
request bodies or response bodies to argv, environment variables, logs or
exception messages.

Keep ESM and CommonJS builds equivalent, preserve the existing public `Locker`
API, and add conformance tests for every protocol change.
