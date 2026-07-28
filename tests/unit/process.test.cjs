'use strict'

const assert = require('node:assert/strict')
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  NodeProcessRunner,
  ProcessFailureReason,
  sanitizedEnvironment,
  windowsTaskkillPath,
} = require('../../lib/cjs/src/executors/process.js')

const fixture = path.resolve('tests/fixtures/process-child.cjs')
const options = {
  timeoutMs: 2000,
  maxStdoutBytes: 1024 * 1024,
  maxStderrBytes: 1024,
}

test('child environment is allow-listed and strips Locker/npm secrets', () => {
  const result = sanitizedEnvironment({
    PATH: '/safe/bin',
    HOME: '/safe/home',
    HTTPS_PROXY: 'https://proxy.example',
    LOCKER_ACCESS_KEY_ID: 'must-not-pass',
    LOCKER_SECRET_ACCESS_KEY: 'must-not-pass',
    LOCKER_ACCESS_KEY: 'must-not-pass',
    LOCKER_SECRET_KEY: 'must-not-pass',
    locker_access_key_id: 'must-not-pass',
    locker_secret_access_key: 'must-not-pass',
    locker_access_key: 'must-not-pass',
    locker_secret_key: 'must-not-pass',
    NPM_TOKEN: 'must-not-pass',
    NODE_OPTIONS: '--require malicious.js',
  })

  assert.deepEqual(result, {
    PATH: '/safe/bin',
    HOME: '/safe/home',
    HTTPS_PROXY: 'https://proxy.example',
  })
})

test(
  'Windows process-tree termination ignores hostile PATH and Windows directory variables',
  { skip: process.platform !== 'win32' },
  () => {
    const hostileDirectory = mkdtempSync(
      path.join(os.tmpdir(), 'locker-hostile-taskkill-'),
    )
    writeFileSync(path.join(hostileDirectory, 'taskkill.exe'), 'not taskkill')
    const original = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
    }
    Object.assign(process.env, {
      PATH: hostileDirectory,
      SystemRoot: hostileDirectory,
      WINDIR: hostileDirectory,
    })
    try {
      const resolved = windowsTaskkillPath()
      assert.ok(resolved)
      assert.equal(path.win32.basename(resolved).toLowerCase(), 'taskkill.exe')
      assert.equal(
        path.win32
          .resolve(resolved)
          .toLowerCase()
          .startsWith(path.win32.resolve(hostileDirectory).toLowerCase()),
        false,
      )
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[name]
        } else {
          process.env[name] = value
        }
      }
      rmSync(hostileDirectory, { recursive: true, force: true })
    }
  },
)

test('spawned process receives no canonical or legacy Locker credentials', async () => {
  const original = {
    LOCKER_ACCESS_KEY_ID: process.env.LOCKER_ACCESS_KEY_ID,
    LOCKER_SECRET_ACCESS_KEY: process.env.LOCKER_SECRET_ACCESS_KEY,
    locker_access_key_id: process.env.locker_access_key_id,
    locker_secret_access_key: process.env.locker_secret_access_key,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
  }
  Object.assign(process.env, {
    LOCKER_ACCESS_KEY_ID: 'must-not-pass',
    LOCKER_SECRET_ACCESS_KEY: 'must-not-pass',
    locker_access_key_id: 'must-not-pass',
    locker_secret_access_key: 'must-not-pass',
    NODE_OPTIONS: '--require definitely-missing.js',
  })

  try {
    const result = await new NodeProcessRunner().run(
      process.execPath,
      [fixture, 'environment'],
      Buffer.alloc(0),
      options,
    )
    assert.deepEqual(JSON.parse(result.stdout), {
      pathPresent: true,
    })
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
})

test('process runner enforces timeout, cancellation and output bounds', async () => {
  const runner = new NodeProcessRunner()
  await assert.rejects(
    runner.run(process.execPath, [fixture, 'hang'], Buffer.alloc(0), {
      ...options,
      timeoutMs: 100,
    }),
    (error) => error.reason === ProcessFailureReason.TIMEOUT,
  )

  const controller = new AbortController()
  const cancelled = runner.run(
    process.execPath,
    [fixture, 'hang'],
    Buffer.alloc(0),
    {
      ...options,
      signal: controller.signal,
    },
  )
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(
    cancelled,
    (error) => error.reason === ProcessFailureReason.ABORTED,
  )

  await assert.rejects(
    runner.run(process.execPath, [fixture, 'large'], Buffer.alloc(0), {
      ...options,
      maxStdoutBytes: 1024,
    }),
    (error) => error.reason === ProcessFailureReason.BUFFER_LIMIT,
  )
  await assert.rejects(
    runner.run(
      process.execPath,
      [fixture, 'invalid-utf8'],
      Buffer.alloc(0),
      options,
    ),
    (error) => error.reason === ProcessFailureReason.ENCODING,
  )
})

test('synchronous process runner enforces timeout and output bounds', () => {
  const runner = new NodeProcessRunner()
  assert.throws(
    () =>
      runner.runSync(process.execPath, [fixture, 'hang'], Buffer.alloc(0), {
        ...options,
        timeoutMs: 100,
      }),
    (error) => error.reason === ProcessFailureReason.TIMEOUT,
  )
  assert.throws(
    () =>
      runner.runSync(process.execPath, [fixture, 'large'], Buffer.alloc(0), {
        ...options,
        maxStdoutBytes: 1024,
      }),
    (error) => error.reason === ProcessFailureReason.BUFFER_LIMIT,
  )
  assert.throws(
    () =>
      runner.runSync(
        process.execPath,
        [fixture, 'invalid-utf8'],
        Buffer.alloc(0),
        options,
      ),
    (error) => error.reason === ProcessFailureReason.ENCODING,
  )
})

test('process runner rejects stdout limits above the 20 MiB protocol cap', async () => {
  const runner = new NodeProcessRunner()
  const oversized = {
    ...options,
    maxStdoutBytes: 20 * 1024 * 1024 + 1,
  }
  await assert.rejects(
    runner.run(
      process.execPath,
      [fixture, 'environment'],
      Buffer.alloc(0),
      oversized,
    ),
    RangeError,
  )
  assert.throws(
    () =>
      runner.runSync(
        process.execPath,
        [fixture, 'environment'],
        Buffer.alloc(0),
        oversized,
      ),
    RangeError,
  )
})

test('synchronous timeout terminates the full descendant process tree', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'locker-js-tree-'))
  const pidPath = path.join(directory, 'child.pid')
  let descendantPID
  try {
    assert.throws(
      () =>
        new NodeProcessRunner().runSync(
          process.execPath,
          [fixture, 'tree-hang', pidPath],
          Buffer.alloc(0),
          { ...options, timeoutMs: 300 },
        ),
      (error) => error.reason === ProcessFailureReason.TIMEOUT,
    )
    assert.equal(existsSync(pidPath), true)
    descendantPID = Number(readFileSync(pidPath, 'utf8'))

    const deadline = Date.now() + 3000
    while (Date.now() < deadline && isProcessAlive(descendantPID)) {
      // The synchronous runner has already killed the tree; this short polling
      // window allows Windows to finish process accounting.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
    assert.equal(isProcessAlive(descendantPID), false)
  } finally {
    if (descendantPID !== undefined && isProcessAlive(descendantPID)) {
      try {
        process.kill(descendantPID, 'SIGKILL')
      } catch {}
    }
    rmSync(directory, { force: true, recursive: true })
  }
})

test(
  'successful POSIX exchange terminates unexpected surviving descendants',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'locker-js-tree-exit-'),
    )
    const pidPath = path.join(directory, 'child.pid')
    let descendantPID
    try {
      const result = await new NodeProcessRunner().run(
        process.execPath,
        [fixture, 'tree-exit', pidPath],
        Buffer.alloc(0),
        options,
      )
      assert.equal(result.stdout, '{}')
      descendantPID = Number(readFileSync(pidPath, 'utf8'))
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && isProcessAlive(descendantPID)) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(isProcessAlive(descendantPID), false)
    } finally {
      if (descendantPID !== undefined && isProcessAlive(descendantPID)) {
        try {
          process.kill(descendantPID, 'SIGKILL')
        } catch {}
      }
      rmSync(directory, { force: true, recursive: true })
    }
  },
)

test(
  'successful synchronous POSIX exchange terminates descendants',
  { skip: process.platform === 'win32' },
  () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'locker-js-sync-tree-exit-'),
    )
    const pidPath = path.join(directory, 'child.pid')
    let descendantPID
    try {
      const result = new NodeProcessRunner().runSync(
        process.execPath,
        [fixture, 'tree-exit', pidPath],
        Buffer.alloc(0),
        options,
      )
      assert.equal(result.stdout, '{}')
      descendantPID = Number(readFileSync(pidPath, 'utf8'))
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && isProcessAlive(descendantPID)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
      }
      assert.equal(isProcessAlive(descendantPID), false)
    } finally {
      if (descendantPID !== undefined && isProcessAlive(descendantPID)) {
        try {
          process.kill(descendantPID, 'SIGKILL')
        } catch {}
      }
      rmSync(directory, { force: true, recursive: true })
    }
  },
)

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
