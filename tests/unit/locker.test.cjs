'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, readFile, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { inspect } = require('node:util')
const {
  ErrorCode,
  Locker,
  LockerAuthenticationError,
  LockerNotFoundError,
  Secret,
} = require('../../lib/cjs/index.js')

function secret(overrides = {}) {
  return {
    object: 'secret',
    id: 'secret-id',
    creation_date: 1,
    revision_date: 2,
    updated_date: null,
    deleted_date: null,
    last_use_date: null,
    project_id: 42,
    environment_id: null,
    environment_name: null,
    key: 'DATABASE_PASSWORD',
    value: 'secret-value',
    description: '',
    ...overrides,
  }
}

function environment(overrides = {}) {
  return {
    object: 'environment',
    id: 'environment-id',
    name: 'production',
    external_url: '',
    description: '',
    creation_date: 1,
    revision_date: 2,
    updated_date: null,
    project_id: 42,
    ...overrides,
  }
}

function protocolError(ErrorType, code, kind) {
  return new ErrorType('safe error', {
    code,
    kind,
    retryable: false,
    requestId: 'request-id',
  })
}

class StubExecutor {
  constructor(handler) {
    this.handler = handler
    this.calls = []
  }

  async execute(method, context, params, options) {
    const call = { method, context, params, options, sync: false }
    this.calls.push(call)
    return await this.handler(call)
  }

  executeSync(method, context, params, options) {
    const call = { method, context, params, options, sync: true }
    this.calls.push(call)
    return this.handler(call)
  }
}

function lockerWith(executor, overrides = {}) {
  return new Locker({
    accessKeyId: 'access-id',
    secretAccessKey: 'credential-secret', // locker:allow-secret -- client fixture
    headers: {
      'CF-Access-Client-Secret': 'header-secret',
    },
    executor,
    ...overrides,
  })
}

test('get applies a default only to NOT_FOUND', async () => {
  const missing = new StubExecutor(() => {
    throw protocolError(
      LockerNotFoundError,
      ErrorCode.NOT_FOUND,
      'not_found_error',
    )
  })
  assert.equal(
    await lockerWith(missing).get('missing', undefined, 'fallback'),
    'fallback',
  )
  assert.equal(
    lockerWith(missing).getSync('missing', undefined, 'fallback'),
    'fallback',
  )

  const denied = new StubExecutor(() => {
    throw protocolError(
      LockerAuthenticationError,
      ErrorCode.AUTHENTICATION,
      'invalid_secret_access_key',
    )
  })
  await assert.rejects(
    lockerWith(denied).get('missing', undefined, 'fallback'),
    LockerAuthenticationError,
  )
  assert.throws(
    () => lockerWith(denied).getSync('missing', undefined, 'fallback'),
    LockerAuthenticationError,
  )
})

test('getRequired is fail-closed and returns a non-optional string', async () => {
  const executor = new StubExecutor(() => secret())
  const locker = lockerWith(executor)

  assert.equal(await locker.getRequired('DATABASE_PASSWORD'), 'secret-value')
  assert.equal(locker.getRequiredSync('DATABASE_PASSWORD'), 'secret-value')
  assert.ok((await locker.retrieve('DATABASE_PASSWORD')) instanceof Secret)
})

test('per-call false and zero override default cache settings', async () => {
  const executor = new StubExecutor(() => [])
  const locker = lockerWith(executor, {
    cacheOptions: {
      fetch: true,
      restTime: 120,
    },
  })
  const controller = new AbortController()

  await locker.list(undefined, {
    fetch: false,
    restTime: 0,
    signal: controller.signal,
    timeoutMs: 1234,
  })

  assert.equal(executor.calls[0].context.fetch, false)
  assert.equal(executor.calls[0].context.restTime, 0)
  assert.equal(executor.calls[0].options.signal, controller.signal)
  assert.equal(executor.calls[0].options.timeoutMs, 1234)
})

test('updates map legacy empty environment to protocol null', async () => {
  const executor = new StubExecutor((call) =>
    secret({
      value: call.params.changes.value,
      environment_name: null,
    }),
  )
  const locker = lockerWith(executor)

  await locker.modify('DATABASE_PASSWORD', 'production', {
    value: '',
    environmentName: '',
    description: '',
  })

  assert.deepEqual(executor.calls[0].params, {
    key: 'DATABASE_PASSWORD',
    environment: 'production',
    changes: {
      value: '',
      environment: null,
      description: '',
    },
  })
})

test('Locker serialization never contains credentials or custom headers', () => {
  const locker = lockerWith(new StubExecutor(() => []))
  const serialized = JSON.stringify(locker)

  assert.doesNotMatch(serialized, /access-id|credential-secret|header-secret/)
  assert.deepEqual(JSON.parse(serialized), {
    apiBase: 'https://api.locker.io/locker_secrets',
    unsafe: false,
  })
})

test('fromEnv uses the canonical Locker credential variable names', () => {
  const locker = Locker.fromEnv({
    env: {
      LOCKER_ACCESS_KEY_ID: 'environment-access',
      ACCESS_KEY_ID: 'legacy-access',
      LOCKER_SECRET_ACCESS_KEY: 'environment-secret', // locker:allow-secret -- precedence fixture
      SECRET_ACCESS_KEY: 'legacy-secret', // locker:allow-secret -- precedence fixture
      LOCKER_ACCESS_KEY_SECRET: 'older-secret', // locker:allow-secret -- precedence fixture
      ACCESS_KEY_SECRET: 'oldest-secret', // locker:allow-secret -- precedence fixture
      LOCKER_API_BASE: 'https://environment.example/locker',
    },
    executor: new StubExecutor(() => []),
  })
  assert.equal(locker.accessKeyId, 'environment-access')
  assert.equal(locker.secretAccessKey, 'environment-secret')
  assert.equal(locker.apiBase, 'https://environment.example/locker')
})

test('fromEnv accepts historical aliases only as migration fallbacks', () => {
  const cases = [
    [
      {
        SECRET_ACCESS_KEY: 'legacy',
        LOCKER_ACCESS_KEY_SECRET: 'older',
        ACCESS_KEY_SECRET: 'oldest',
      },
      'legacy',
    ],
    [
      {
        LOCKER_ACCESS_KEY_SECRET: 'older',
        ACCESS_KEY_SECRET: 'oldest',
      },
      'older',
    ],
    [{ ACCESS_KEY_SECRET: 'oldest' }, 'oldest'],
  ]

  for (const [environment, expected] of cases) {
    const locker = Locker.fromEnv({
      env: {
        ACCESS_KEY_ID: 'legacy-access',
        ...environment,
      },
      executor: new StubExecutor(() => []),
    })
    assert.equal(locker.accessKeyId, 'legacy-access')
    assert.equal(locker.secretAccessKey, expected)
  }
})

test('resource conversion rejects incomplete protocol data', async () => {
  const locker = lockerWith(
    new StubExecutor(() => ({
      object: 'secret',
      key: 'incomplete',
    })),
  )
  await assert.rejects(
    locker.retrieve('incomplete'),
    /field id must be a string/,
  )

  for (const invalid of [
    secret({ project_id: 1.5 }),
    secret({ secret_hash: 'must-not-cross-the-protocol' }),
  ]) {
    await assert.rejects(
      lockerWith(new StubExecutor(() => invalid)).retrieve('invalid'),
      TypeError,
    )
  }
})

test('secret inspection redacts values while explicit JSON stays current', () => {
  const value = 'do-not-log-this-secret'
  const resource = new Secret(secret({ value }))

  assert.doesNotMatch(inspect(resource), new RegExp(value))
  assert.match(resource.toString(), /\[REDACTED\]/)

  resource.value = 'rotated-secret'
  const exported = resource.toJSON()
  assert.equal(exported.value, 'rotated-secret')
  exported.value = 'caller-mutated-copy'
  assert.equal(resource.toJSON().value, 'rotated-secret')
})

test('runtime options are validated before reaching a protocol executor', async () => {
  const executor = new StubExecutor(() => [])
  assert.throws(
    () =>
      lockerWith(executor, {
        headers: { invalid: 42 },
      }),
    /must be a string/,
  )
  await assert.rejects(
    lockerWith(executor).list(undefined, { restTime: 86_401 }),
    /restTime/,
  )
})

test('bounded page APIs return typed immutable items and cursors', async () => {
  const executor = new StubExecutor((call) => {
    if (call.method === 'secret.list_page') {
      return {
        object: 'secret_page',
        items: [secret()],
        next_cursor: 'secret-cursor',
      }
    }
    if (call.method === 'environment.list_page') {
      return {
        object: 'environment_page',
        items: [environment()],
        next_cursor: null,
      }
    }
    throw new Error(`unexpected method ${call.method}`)
  })
  const locker = lockerWith(executor)

  const secretPage = await locker.listPage({ pageSize: 25 }, 'production')
  assert.ok(secretPage.items[0] instanceof Secret)
  assert.equal(secretPage.nextCursor, 'secret-cursor')
  assert.ok(Object.isFrozen(secretPage))
  assert.ok(Object.isFrozen(secretPage.items))
  assert.deepEqual(executor.calls[0].params, {
    page_size: 25,
    environment: 'production',
  })

  const environmentPage = locker.listEnvironmentsPageSync({
    pageSize: 10,
    cursor: 'environment-cursor',
  })
  assert.equal(environmentPage.items[0].name, 'production')
  assert.equal(environmentPage.nextCursor, null)
  assert.ok(Object.isFrozen(environmentPage))
  assert.ok(Object.isFrozen(environmentPage.items))
  assert.deepEqual(executor.calls[1].params, {
    page_size: 10,
    cursor: 'environment-cursor',
  })

  await assert.rejects(locker.listPage({ pageSize: 1001 }), /pageSize/)
})

test('export writes a private local file without human CLI output flags', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locker-js-export-'))
  const output = path.join(directory, '.env')
  const executor = new StubExecutor(() => [
    secret({ key: 'API_KEY', value: 'line 1\n$line 2' }),
  ])

  await lockerWith(executor).export({
    outputFile: output,
    format: 'env',
  })

  // locker:allow-secret -- deterministic export fixture
  assert.equal(await readFile(output, 'utf8'), 'API_KEY="line 1\\n\\$line 2"\n')
  if (process.platform !== 'win32') {
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  }
  assert.equal(executor.calls[0].method, 'secret.list')
})

test('import parses default/environment sections and uses protocol methods', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locker-js-import-'))
  const source = path.join(directory, 'secrets.ini')
  await writeFile(
    source,
    [
      'DEFAULT_SECRET="default value"', // locker:allow-secret -- deterministic import fixture
      '[production]',
      'API_KEY="line 1\\nline 2"',
    ].join('\n'),
    'utf8',
  )

  const executor = new StubExecutor((call) => {
    switch (call.method) {
      case 'environment.get':
        throw protocolError(
          LockerNotFoundError,
          ErrorCode.NOT_FOUND,
          'not_found_error',
        )
      case 'environment.create':
        return environment({ name: call.params.name })
      case 'secret.create':
        return secret({
          key: call.params.key,
          value: call.params.value,
          environment_name: call.params.environment ?? null,
        })
      default:
        throw new Error(`unexpected method ${call.method}`)
    }
  })

  await lockerWith(executor).import(source)

  assert.deepEqual(
    executor.calls.map((call) => ({
      method: call.method,
      params: call.params,
    })),
    [
      {
        method: 'secret.create',
        params: {
          key: 'DEFAULT_SECRET',
          value: 'default value',
        },
      },
      {
        method: 'environment.get',
        params: {
          name: 'production',
        },
      },
      {
        method: 'environment.create',
        params: {
          name: 'production',
        },
      },
      {
        method: 'secret.create',
        params: {
          key: 'API_KEY',
          value: 'line 1\nline 2',
          environment: 'production',
        },
      },
    ],
  )
})
