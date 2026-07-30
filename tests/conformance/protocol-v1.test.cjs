'use strict'

const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { BinaryExecutor } = require('../../lib/cjs/src/executors/binary.js')
const {
  ProcessFailure,
  ProcessFailureReason,
} = require('../../lib/cjs/src/executors/process.js')
const {
  ErrorCode,
  errorFromResponse,
  LockerAlreadyExistsError,
  LockerCancelledError,
  LockerConflictError,
  LockerError,
  LockerIntegrityError,
  LockerNotFoundError,
  LockerOperationCancelledError,
  LockerProtocolError,
  LockerRequestRejectedError,
  LockerResponseTooLargeError,
  LockerServerError,
  LockerTimeoutError,
  LockerTransportError,
  LockerValidationError,
  LogLevel,
} = require('../../lib/cjs/index.js')
const { Logger } = require('../../lib/cjs/src/utils/logger.js')

const METHODS = [
  'environment.create',
  'environment.get',
  'environment.list',
  'environment.list_page',
  'environment.update',
  'secret.create',
  'secret.get',
  'secret.list',
  'secret.list_page',
  'secret.update',
  'system.capabilities',
]

function resultResponse(request, data, extra = {}) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocol_version: 1,
      data,
      meta: {
        cli_version: '1.2.3',
      },
      ignored_result_field: true,
    },
    ignored_envelope_field: true,
    ...extra,
  })
}

function capabilities(overrides = {}) {
  const result = {
    protocol: {
      name: 'locker.sdk',
      min_version: 1,
      max_version: 1,
      transport: 'json-rpc-2.0-stdio',
      ...overrides.protocol,
    },
    cli: {
      version: '1.2.3',
    },
    methods: overrides.methods ?? METHODS,
    limits: {
      max_json_depth: 256,
      max_request_bytes: 20 * 1024 * 1024,
      max_response_bytes: 20 * 1024 * 1024,
      ...overrides.limits,
    },
  }
  if (overrides.error_contracts !== null) {
    result.error_contracts = overrides.error_contracts ?? ['typed-v1']
  }
  return result
}

class FakeRunner {
  constructor(handler, advertisedCapabilities = capabilities()) {
    this.handler = handler
    this.advertisedCapabilities = advertisedCapabilities
    this.calls = []
  }

  invoke(executable, args, stdin, options) {
    const serialized = stdin.toString('utf8')
    const request = JSON.parse(serialized)
    const call = {
      executable,
      args: [...args],
      options,
      request,
    }
    this.calls.push(call)
    const stdout =
      request.method === 'system.capabilities'
        ? resultResponse(request, this.advertisedCapabilities)
        : this.handler(request)
    return {
      stdout,
      exitCode: 0,
      signal: null,
      durationMs: 2,
    }
  }

  async run(executable, args, stdin, options) {
    return this.invoke(executable, args, stdin, options)
  }

  runSync(executable, args, stdin, options) {
    return this.invoke(executable, args, stdin, options)
  }
}

class DelayedRunner extends FakeRunner {
  constructor(delayMs) {
    super((request) => resultResponse(request, { ok: true }))
    this.delayMs = delayMs
  }

  async run(executable, args, stdin, options) {
    const waitMs = Math.min(this.delayMs, options.timeoutMs)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    if (options.timeoutMs < this.delayMs) {
      stdin.fill(0)
      throw new ProcessFailure(ProcessFailureReason.TIMEOUT)
    }
    return this.invoke(executable, args, stdin, options)
  }
}

function executorFor(runner) {
  return new BinaryExecutor(new Logger(LogLevel.NONE), {
    cliPath: realpathSync.native(process.execPath),
    clientVersion: '9.8.7',
    runner,
  })
}

const context = {
  accessKeyId: '00000000-0000-4000-8000-000000000001',
  secretAccessKey: 'Zml4dHVyZS1zZWNyZXQ=', // locker:allow-secret -- protocol fixture
  apiBase: 'https://example.test/locker',
  headers: {
    'CF-Access-Client-Secret': 'header-secret',
  },
  unsafe: false,
  fetch: false,
  restTime: 0,
}

test('negotiates capabilities once and sends only sdk in argv', async () => {
  const runner = new FakeRunner((request) =>
    resultResponse(request, { ok: true }),
  )
  const executor = executorFor(runner)

  assert.deepEqual(
    await executor.execute('secret.get', context, {
      key: 'DATABASE_PASSWORD',
      environment: 'production',
    }),
    { ok: true },
  )
  await executor.execute('secret.list', context, {})

  assert.equal(runner.calls.length, 3)
  assert.equal(runner.calls[0].request.method, 'system.capabilities')
  assert.equal(runner.calls[1].request.method, 'secret.get')
  assert.equal(runner.calls[2].request.method, 'secret.list')
  for (const call of runner.calls) {
    assert.deepEqual(call.args, ['sdk'])
    assert.doesNotMatch(
      JSON.stringify(call.args),
      /Zml4dHVyZS1zZWNyZXQ=|header-secret|DATABASE_PASSWORD/,
    )
  }

  const operation = runner.calls[1].request
  assert.equal(operation.jsonrpc, '2.0')
  assert.equal(typeof operation.id, 'string')
  assert.deepEqual(operation.params.context, {
    protocol_version: 1,
    error_contract: 'typed-v1',
    credentials: {
      access_key_id: '00000000-0000-4000-8000-000000000001',
      secret_access_key: 'Zml4dHVyZS1zZWNyZXQ=', // locker:allow-secret -- protocol fixture
    },
    client: {
      name: 'locker-js',
      version: '9.8.7',
    },
    transport: {
      api_base: 'https://example.test/locker',
      headers: {
        'CF-Access-Client-Secret': 'header-secret',
      },
      insecure_skip_tls_verify: false,
    },
    cache: {
      force_refresh: false,
      max_age_seconds: 0,
    },
  })
})

test('binds typed errors only when the exact capability is advertised', async () => {
  for (const advertised of [
    capabilities({ error_contracts: null }),
    capabilities({ error_contracts: ['future-v2'] }),
  ]) {
    const runner = new FakeRunner(
      (request) => resultResponse(request, { ok: true }),
      advertised,
    )
    assert.deepEqual(
      await executorFor(runner).execute('secret.get', context, {
        key: 'DATABASE_PASSWORD',
      }),
      { ok: true },
    )
    assert.equal(
      Object.hasOwn(runner.calls[1].request.params.context, 'error_contract'),
      false,
    )
  }

  for (const errorContracts of [
    ['typed-v1', 'typed-v1'],
    ['Invalid_Contract'],
  ]) {
    const runner = new FakeRunner(
      () => {
        throw new Error('operation must not run')
      },
      capabilities({ error_contracts: errorContracts }),
    )
    await assert.rejects(
      executorFor(runner).execute('secret.get', context, {
        key: 'DATABASE_PASSWORD',
      }),
      LockerTransportError,
    )
    assert.equal(runner.calls.length, 1)
  }
})

test('one timeout budget covers capability negotiation and operation', async () => {
  const runner = new DelayedRunner(30)
  const executor = executorFor(runner)

  await assert.rejects(
    executor.execute(
      'secret.get',
      context,
      { key: 'DATABASE_PASSWORD' },
      { timeoutMs: 45 },
    ),
    LockerTimeoutError,
  )
  assert.equal(runner.calls.length, 1)
  assert.equal(runner.calls[0].request.method, 'system.capabilities')
})

test('sync transport also negotiates and uses the same envelope', () => {
  const runner = new FakeRunner((request) => resultResponse(request, ['one']))
  const executor = executorFor(runner)

  assert.deepEqual(executor.executeSync('secret.list', context, {}), ['one'])
  assert.equal(runner.calls.length, 2)
  assert.deepEqual(runner.calls[0].args, ['sdk'])
  assert.deepEqual(runner.calls[1].args, ['sdk'])
})

test('maps JSON-RPC NOT_FOUND and retains stable metadata', async () => {
  const runner = new FakeRunner((request) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Locker resource was not found',
        data: {
          protocol_version: 1,
          kind: 'not_found_error',
          retryable: false,
        },
      },
    }),
  )

  await assert.rejects(
    executorFor(runner).execute('secret.get', context, { key: 'missing' }),
    (error) => {
      assert.ok(error instanceof LockerNotFoundError)
      assert.equal(error.code, ErrorCode.NOT_FOUND)
      assert.equal(error.kind, 'not_found_error')
      assert.equal(error.retryable, false)
      assert.equal(typeof error.requestId, 'string')
      return true
    },
  )
})

test('maps stable and legacy operation error taxonomy', async () => {
  const cases = [
    {
      code: ErrorCode.CONFLICT,
      kind: 'secret_already_exists',
      type: LockerAlreadyExistsError,
      message: 'a secret with this key already exists',
    },
    {
      code: ErrorCode.CONFLICT,
      kind: 'conflict',
      type: LockerConflictError,
      message: 'the operation conflicts with current state',
    },
    {
      code: ErrorCode.VALIDATION,
      kind: 'validation_error',
      type: LockerValidationError,
      message: 'the request is invalid',
    },
    {
      code: ErrorCode.INTEGRITY,
      kind: 'integrity_error',
      type: LockerIntegrityError,
      message: 'stored data failed an integrity check',
    },
    {
      code: ErrorCode.SERVER,
      kind: 'internal_error',
      type: LockerServerError,
      message: 'the request could not be completed',
    },
    {
      code: ErrorCode.OPERATION_FAILED,
      kind: 'duplicate_hash',
      type: LockerAlreadyExistsError,
      message: 'the requested resource already exists',
    },
    {
      code: ErrorCode.OPERATION_FAILED,
      kind: 'conflict',
      type: LockerConflictError,
      message: 'the operation conflicts with current state',
    },
    {
      code: ErrorCode.OPERATION_FAILED,
      kind: 'request_rejected',
      type: LockerRequestRejectedError,
      message: 'the request is invalid',
    },
    {
      code: ErrorCode.OPERATION_FAILED,
      kind: 'response_too_large',
      type: LockerResponseTooLargeError,
      message: 'protocol response exceeds the size limit',
    },
    {
      code: ErrorCode.OPERATION_FAILED,
      kind: 'cancelled',
      type: LockerOperationCancelledError,
      message: 'request cancelled',
    },
  ]

  for (const taxonomy of cases) {
    const runner = new FakeRunner((request) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: taxonomy.code,
          message: 'sensitive-value-from-broken-cli',
          data: {
            protocol_version: 1,
            kind: taxonomy.kind,
            retryable: true,
          },
        },
      }),
    )

    await assert.rejects(
      executorFor(runner).execute('secret.create', context, {
        key: 'PAYMENT_API_KEY',
        value: 'secret-value',
      }),
      (error) => {
        assert.ok(error instanceof taxonomy.type)
        assert.equal(error.code, taxonomy.code)
        assert.equal(error.kind, taxonomy.kind)
        assert.equal(error.retryable, false)
        assert.equal(error.message, taxonomy.message)
        assert.doesNotMatch(error.message, /sensitive-value/)
        if (error instanceof LockerAlreadyExistsError) {
          assert.ok(error instanceof LockerConflictError)
        }
        return true
      },
    )
  }

  const generic = new FakeRunner((request) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: ErrorCode.OPERATION_FAILED,
        message: 'generic rejection',
        data: {
          protocol_version: 1,
          kind: 'request_rejected',
          retryable: false,
        },
      },
    }),
  )
  await assert.rejects(
    executorFor(generic).execute('secret.create', context, {}),
    (error) => {
      assert.equal(error.constructor, LockerRequestRejectedError)
      assert.ok(error instanceof LockerError)
      assert.equal(error.message, 'the request is invalid')
      assert.equal(error.retryable, false)
      return true
    },
  )

  const futureServer = new FakeRunner((request) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32099,
        message: 'safe future error',
        data: {
          protocol_version: 1,
          kind: 'future_error',
          retryable: true,
        },
      },
    }),
  )
  await assert.rejects(
    executorFor(futureServer).execute('secret.get', context, {}),
    (error) => {
      assert.equal(error.constructor, LockerError)
      assert.equal(error.code, -32099)
      assert.equal(error.retryable, true)
      return true
    },
  )

  const futureKnownKind = new FakeRunner((request) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32099,
        message: 'safe future error',
        data: {
          protocol_version: 1,
          kind: 'secret_already_exists',
          retryable: true,
        },
      },
    }),
  )
  await assert.rejects(
    executorFor(futureKnownKind).execute('secret.get', context, {}),
    (error) => {
      assert.equal(error.constructor, LockerError)
      assert.equal(error.message, 'the Locker operation failed')
      assert.equal(error.retryable, true)
      return true
    },
  )

  for (const malformed of [
    { code: -32100, kind: 'future_error', message: 'safe error' },
    { code: -32000, kind: 'Invalid-Kind', message: 'safe error' },
    { code: -32000, kind: 'operation_error', message: 'line one\nline two' },
    { code: -32000, kind: 'operation_error', message: 'é'.repeat(513) },
  ]) {
    const runner = new FakeRunner((request) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: malformed.code,
          message: malformed.message,
          data: {
            protocol_version: 1,
            kind: malformed.kind,
            retryable: false,
          },
        },
      }),
    )
    await assert.rejects(
      executorFor(runner).execute('secret.get', context, {}),
      LockerProtocolError,
    )
  }
})

test('uses canonical protocol messages and closed retry semantics', () => {
  const cases = [
    [
      ErrorCode.PARSE,
      'parse_error',
      'the Locker CLI returned invalid JSON',
      false,
    ],
    [
      ErrorCode.INVALID_REQUEST,
      'invalid_request',
      'the Locker CLI rejected the request envelope',
      false,
    ],
    [
      ErrorCode.METHOD_NOT_FOUND,
      'method_not_found',
      'the requested Locker operation is not supported',
      false,
    ],
    [
      ErrorCode.INVALID_PARAMS,
      'invalid_params',
      'the Locker request parameters are invalid',
      false,
    ],
    [
      ErrorCode.INTERNAL,
      'internal_protocol_error',
      'the Locker CLI encountered an internal protocol error',
      false,
    ],
    [
      ErrorCode.AUTHENTICATION,
      'missing_credentials',
      'access key ID and secret access key are required',
      false,
    ],
    [
      ErrorCode.AUTHENTICATION,
      'invalid_access_key_id',
      'access key ID must be a UUIDv4',
      false,
    ],
    [
      ErrorCode.AUTHENTICATION,
      'malformed_secret_access_key',
      'secret access key must be non-empty canonical base64',
      false,
    ],
    [
      ErrorCode.AUTHENTICATION,
      'invalid_secret_access_key',
      'the secret access key does not match the access key ID',
      false,
    ],
    [ErrorCode.AUTHENTICATION, 'unauthorized', 'authentication failed', false],
    [
      ErrorCode.PERMISSION_DENIED,
      'permission_denied',
      'you do not have permission to perform this operation',
      false,
    ],
    [
      ErrorCode.NOT_FOUND,
      'not_found_error',
      'the requested resource was not found',
      false,
    ],
    [
      ErrorCode.STORAGE,
      'storage_error',
      'local storage operation failed',
      false,
    ],
    [
      ErrorCode.SERVER,
      'internal_error',
      'the request could not be completed',
      false,
    ],
    [
      ErrorCode.SERVER,
      'service_unavailable',
      'the service is temporarily unavailable',
      true,
    ],
  ]
  for (const [code, kind, message, retryable] of cases) {
    const error = errorFromResponse(
      code,
      'sensitive-value-from-broken-cli',
      kind,
      true,
      'request-canonical',
    )
    assert.equal(error.message, message)
    assert.equal(error.retryable, retryable)
  }
})

test('validates and exposes rate-limit retry-after metadata without retrying', async () => {
  for (const retryAfterSeconds of [0, 86400]) {
    const runner = new FakeRunner((request) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'unsafe rate limit detail',
          data: {
            protocol_version: 1,
            kind: 'rate_limited',
            retryable: true,
            retry_after_seconds: retryAfterSeconds,
          },
        },
      }),
    )
    await assert.rejects(
      executorFor(runner).execute('secret.get', context, {}),
      (error) => {
        assert.equal(error.retryAfterSeconds, retryAfterSeconds)
        assert.equal(error.retryable, true)
        return true
      },
    )
    assert.equal(runner.calls.length, 2)
  }

  for (const retryAfterSeconds of [true, -1, 86401, 1.5]) {
    const runner = new FakeRunner((request) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'unsafe rate limit detail',
          data: {
            protocol_version: 1,
            kind: 'rate_limited',
            retryable: true,
            retry_after_seconds: retryAfterSeconds,
          },
        },
      }),
    )
    await assert.rejects(
      executorFor(runner).execute('secret.get', context, {}),
      LockerProtocolError,
    )
  }

  const serverError = errorFromResponse(
    ErrorCode.SERVER,
    'unsafe server detail',
    'service_unavailable',
    true,
    'request-server',
    30,
  )
  assert.equal(serverError.retryAfterSeconds, undefined)
})

test('validates and separates the upstream server request id', async () => {
  const serverRequestId = 'upstream_Request-123456'
  const runner = new FakeRunner((request) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: ErrorCode.SERVER,
        message: 'unsafe server detail',
        data: {
          protocol_version: 1,
          kind: 'service_unavailable',
          retryable: true,
          server_request_id: serverRequestId,
        },
      },
    }),
  )
  await assert.rejects(
    executorFor(runner).execute('secret.get', context, {}),
    (error) => {
      assert.notEqual(error.requestId, error.serverRequestId)
      assert.equal(error.serverRequestId, serverRequestId)
      return true
    },
  )

  for (const invalid of [
    true,
    'short',
    'request.id.not.allowed',
    'a'.repeat(129),
  ]) {
    const invalidRunner = new FakeRunner((request) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: ErrorCode.SERVER,
          message: 'unsafe server detail',
          data: {
            protocol_version: 1,
            kind: 'service_unavailable',
            retryable: true,
            server_request_id: invalid,
          },
        },
      }),
    )
    await assert.rejects(
      executorFor(invalidRunner).execute('secret.get', context, {}),
      LockerProtocolError,
    )
  }
})

test('rejects mismatched response ids and incompatible capabilities', async () => {
  const mismatched = new FakeRunner((request) =>
    resultResponse(request, {}, { id: 'different-id' }),
  )
  await assert.rejects(
    executorFor(mismatched).execute('secret.list', context, {}),
    LockerTransportError,
  )

  const incompatible = new FakeRunner(() => {
    throw new Error('operation must not run')
  })
  incompatible.invoke = function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout: resultResponse(
        request,
        capabilities({
          protocol: {
            min_version: 2,
            max_version: 2,
          },
        }),
      ),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }
  await assert.rejects(
    executorFor(incompatible).execute('secret.list', context, {}),
    LockerTransportError,
  )
})

test('rejects duplicate fields, unpaired surrogates and excessive nesting', async () => {
  const duplicate = new FakeRunner(
    (request) =>
      `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},` +
      `"result":{"protocol_version":1,"data":[],"data":[],` +
      '"meta":{"cli_version":"1.2.3"}}}',
  )
  await assert.rejects(
    executorFor(duplicate).execute('secret.list', context, {}),
    LockerTransportError,
  )

  const unpairedSurrogate = new FakeRunner(
    (request) =>
      `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},` +
      '"result":{"protocol_version":1,"data":"\\ud800",' +
      '"meta":{"cli_version":"1.2.3"}}}',
  )
  await assert.rejects(
    executorFor(unpairedSurrogate).execute('secret.list', context, {}),
    LockerTransportError,
  )

  const nested = new FakeRunner((request) => {
    const data = `${'['.repeat(300)}null${']'.repeat(300)}`
    return (
      `{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},` +
      `"result":{"protocol_version":1,"data":${data},` +
      '"meta":{"cli_version":"1.2.3"}}}'
    )
  })
  await assert.rejects(
    executorFor(nested).execute('secret.list', context, {}),
    LockerTransportError,
  )
})

test('rejects unencodable requests and invalid capability collections', async () => {
  const cyclic = {}
  cyclic.self = cyclic
  const cycleRunner = new FakeRunner(() => {
    throw new Error('operation must not run')
  })
  await assert.rejects(
    executorFor(cycleRunner).execute('secret.create', context, {
      key: 'KEY',
      value: cyclic,
    }),
    LockerTransportError,
  )
  await assert.rejects(
    executorFor(cycleRunner).execute('secret.create', context, {
      key: 'KEY',
      value: '\ud800',
    }),
    LockerTransportError,
  )
  await assert.rejects(
    executorFor(cycleRunner).execute('secret.create', context, {
      key: 'KEY',
      value: Number.NaN,
    }),
    LockerTransportError,
  )

  const duplicateMethods = new FakeRunner(() => {
    throw new Error('operation must not run')
  })
  duplicateMethods.invoke = function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout: resultResponse(
        request,
        capabilities({ methods: [...METHODS, 'secret.get'] }),
      ),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }
  await assert.rejects(
    executorFor(duplicateMethods).execute('secret.list', context, {}),
    LockerTransportError,
  )

  const invalidResponseLimit = new FakeRunner(() => {
    throw new Error('operation must not run')
  })
  invalidResponseLimit.invoke = function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout: resultResponse(
        request,
        capabilities({
          limits: { max_response_bytes: 0 },
        }),
      ),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }
  await assert.rejects(
    executorFor(invalidResponseLimit).execute('secret.list', context, {}),
    LockerTransportError,
  )

  const missingCapabilitiesMethod = new FakeRunner(() => {
    throw new Error('operation must not run')
  })
  missingCapabilitiesMethod.invoke = function (
    executable,
    args,
    stdin,
    options,
  ) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout: resultResponse(
        request,
        capabilities({
          methods: METHODS.filter((method) => method !== 'system.capabilities'),
        }),
      ),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }
  await assert.rejects(
    executorFor(missingCapabilitiesMethod).execute('secret.list', context, {}),
    LockerTransportError,
  )
})

test('page methods are additive capabilities checked before operation spawn', async () => {
  const runner = new FakeRunner((request) =>
    resultResponse(request, { ok: true }),
  )
  runner.invoke = function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout:
        request.method === 'system.capabilities'
          ? resultResponse(
              request,
              capabilities({
                methods: METHODS.filter(
                  (method) =>
                    method !== 'secret.list_page' &&
                    method !== 'environment.list_page',
                ),
              }),
            )
          : resultResponse(request, { ok: true }),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }
  const executor = executorFor(runner)

  assert.deepEqual(await executor.execute('secret.list', context, {}), {
    ok: true,
  })
  await assert.rejects(
    executor.execute('secret.list_page', context, {}),
    LockerTransportError,
  )
  assert.equal(
    runner.calls.filter((call) => call.request.method === 'secret.list_page')
      .length,
    0,
  )
})

test('caps negotiated request and response limits to SDK safety limits', async () => {
  const runner = new FakeRunner((request) =>
    resultResponse(request, { ok: true }),
  )
  runner.invoke = function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    this.calls.push({ executable, args: [...args], options, request })
    return {
      stdout:
        request.method === 'system.capabilities'
          ? resultResponse(
              request,
              capabilities({
                limits: {
                  max_request_bytes: 100 * 1024 * 1024,
                  max_response_bytes: 4096,
                },
              }),
            )
          : resultResponse(request, { ok: true }),
      exitCode: 0,
      signal: null,
      durationMs: 1,
    }
  }

  assert.deepEqual(
    await executorFor(runner).execute('secret.list', context, {}),
    { ok: true },
  )
  assert.equal(runner.calls[0].options.maxStdoutBytes, 20 * 1024 * 1024)
  assert.equal(runner.calls[1].options.maxStdoutBytes, 4096)
  assert.throws(
    () =>
      new BinaryExecutor(new Logger(LogLevel.NONE), {
        cliPath: realpathSync.native(process.execPath),
        maxBufferBytes: 20 * 1024 * 1024 + 1,
        runner,
      }),
    /maxBufferBytes/,
  )
})

test('maps process cancellation and timeout without retaining payloads', async () => {
  for (const [reason, ErrorType] of [
    [ProcessFailureReason.ABORTED, LockerCancelledError],
    [ProcessFailureReason.TIMEOUT, LockerTimeoutError],
  ]) {
    const runner = new FakeRunner(() => {
      throw new Error('operation must not run')
    })
    runner.invoke = function () {
      throw new ProcessFailure(reason)
    }
    await assert.rejects(
      executorFor(runner).execute('secret.get', context, {
        key: 'sensitive-key',
      }),
      (error) => {
        assert.ok(error instanceof ErrorType)
        assert.doesNotMatch(error.message, /sensitive|Zml4dHVyZS1zZWNyZXQ=/)
        return true
      },
    )
  }
})

test('a cancelled first negotiation does not poison concurrent callers', async () => {
  const runner = new FakeRunner((request) =>
    resultResponse(request, { healthy: true }),
  )
  let notifyCancelledNegotiationStarted
  const cancelledNegotiationStarted = new Promise((resolve) => {
    notifyCancelledNegotiationStarted = resolve
  })
  runner.run = async function (executable, args, stdin, options) {
    const request = JSON.parse(stdin.toString('utf8'))
    if (
      request.method === 'system.capabilities' &&
      options.signal !== undefined
    ) {
      this.calls.push({
        executable,
        args: [...args],
        options,
        request,
      })
      notifyCancelledNegotiationStarted()
      return await new Promise((_resolve, reject) => {
        const abort = () =>
          reject(new ProcessFailure(ProcessFailureReason.ABORTED))
        if (options.signal.aborted) {
          abort()
        } else {
          options.signal.addEventListener('abort', abort, { once: true })
        }
      })
    }
    return this.invoke(executable, args, stdin, options)
  }

  const executor = executorFor(runner)
  const controller = new AbortController()
  const cancelled = executor.execute(
    'secret.list',
    context,
    {},
    { signal: controller.signal },
  )
  await cancelledNegotiationStarted

  assert.deepEqual(await executor.execute('secret.list', context, {}), {
    healthy: true,
  })
  controller.abort()
  await assert.rejects(cancelled, LockerCancelledError)
  assert.equal(
    runner.calls.filter((call) => call.request.method === 'system.capabilities')
      .length,
    2,
  )
})

test('binary identity changes invalidate cached capabilities', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'locker-js-identity-'))
  const binaryPath = path.join(
    directory,
    process.platform === 'win32' ? 'locker.exe' : 'locker',
  )
  try {
    writeFileSync(binaryPath, 'first binary')
    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o700)
    }
    const runner = new FakeRunner((request) =>
      resultResponse(request, { ok: true }),
    )
    const executor = new BinaryExecutor(new Logger(LogLevel.NONE), {
      cliPath: binaryPath,
      clientVersion: '9.8.7',
      runner,
    })

    await executor.execute('secret.list', context, {})
    writeFileSync(binaryPath, 'replacement binary with a new identity')
    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o700)
    }
    await executor.execute('secret.list', context, {})

    assert.equal(
      runner.calls.filter(
        (call) => call.request.method === 'system.capabilities',
      ).length,
      2,
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('binds every response cli version to negotiated capabilities', async () => {
  const runner = new FakeRunner((request) =>
    resultResponse(
      request,
      { ok: true },
      {
        result: {
          protocol_version: 1,
          data: { ok: true },
          meta: { cli_version: '9.9.9' },
        },
      },
    ),
  )
  const executor = executorFor(runner)

  await assert.rejects(
    executor.execute('secret.list', context, {}),
    (error) =>
      error instanceof LockerTransportError &&
      /differs from negotiated/.test(error.message),
  )

  class CapabilityVersionMismatchRunner extends FakeRunner {
    invoke(executable, args, stdin, options) {
      const result = super.invoke(executable, args, stdin, options)
      const response = JSON.parse(result.stdout)
      response.result.meta.cli_version = '9.9.9'
      return { ...result, stdout: JSON.stringify(response) }
    }
  }
  const capabilityMismatch = executorFor(
    new CapabilityVersionMismatchRunner(() => {
      throw new Error('operation must not run')
    }),
  )
  await assert.rejects(
    capabilityMismatch.execute('secret.list', context, {}),
    (error) =>
      error instanceof LockerTransportError &&
      /differs from negotiated/.test(error.message),
  )
})
