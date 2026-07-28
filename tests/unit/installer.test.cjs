'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash, generateKeyPairSync, sign } = require('node:crypto')
const {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

async function installer() {
  return await import(
    pathToFileURL(path.resolve('scripts/install-cli.mjs')).href
  )
}

test('bundled production trust root is provisioned and canonical', async () => {
  const updateModule = await installer()
  const trust = await updateModule.loadReleaseTrust(
    path.resolve('locker-cli-release.json'),
  )

  assert.equal(trust.baseUrl, updateModule.BASE_URL)
  assert.equal(trust.keyId, updateModule.KEY_ID)
  assert.equal(trust.publicKey.length, 32)
  assert.equal(trust.checkIntervalSeconds, updateModule.CHECK_INTERVAL_SECONDS)
  trust.publicKey.fill(0)
})

test('compares every stable major-2 release without integer overflow', async () => {
  const updateModule = await installer()
  assert.equal(updateModule.compareVersions('2.1.0', '2.0.999'), 1)
  assert.equal(updateModule.compareVersions('2.0.1000', '2.1.0'), -1)
  assert.equal(
    updateModule.compareVersions(
      '2.12345678901234567890.0',
      '2.9999999999999999999.99999999999999999999',
    ),
    1,
  )
  assert.equal(updateModule.compareVersions('2.1.7', '2.1.7'), 0)
  for (const invalid of ['2.01.0', '2.0.01', '2.0', '2.0.0-rc.1', '3.0.0']) {
    assert.throws(
      () => updateModule.compareVersions(invalid, '2.0.0'),
      /version is invalid/u,
    )
  }
})

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function binaryFor(identity) {
  const binary = Buffer.alloc(128)
  if (identity.os === 'linux') {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(binary)
    binary.writeUInt16LE(identity.arch === 'amd64' ? 0x3e : 0xb7, 18)
  } else if (identity.os === 'darwin') {
    binary.writeUInt32LE(0xfeedfacf, 0)
    binary.writeUInt32LE(identity.arch === 'amd64' ? 0x01000007 : 0x0100000c, 4)
  } else {
    binary.write('MZ', 0, 'ascii')
    binary.writeUInt32LE(64, 60)
    binary.write('PE\0\0', 64, 'binary')
    binary.writeUInt16LE(0x8664, 68)
  }
  return binary
}

async function signedChannel(options = {}) {
  const module = await installer()
  const version = options.version ?? '2.0.7'
  const sourceCommit = options.sourceCommit ?? 'a'.repeat(40)
  const identity = options.identity ?? module.platformIdentity()
  const pair = options.pair ?? generateKeyPairSync('ed25519')
  const publicDER = pair.publicKey.export({ format: 'der', type: 'spki' })
  const publicKey = Buffer.from(publicDER.subarray(publicDER.length - 32))
  const trust = {
    baseUrl: module.BASE_URL,
    keyId: module.KEY_ID,
    publicKey,
    checkIntervalSeconds: module.CHECK_INTERVAL_SECONDS,
  }
  const binary = options.binary ?? binaryFor(identity)
  const artifactSignature = sign(null, binary, pair.privateKey)
  if (options.mutateArtifactSignature) {
    artifactSignature[0] ^= 0xff
  }
  const targets = [
    ['linux', 'amd64', 'locker-linux-amd64'],
    ['linux', 'arm64', 'locker-linux-arm64'],
    ['darwin', 'amd64', 'locker-darwin-amd64'],
    ['darwin', 'arm64', 'locker-darwin-arm64'],
    ['windows', 'amd64', 'locker-windows-amd64.exe'],
  ]
  const artifacts = targets.map(
    ([operatingSystem, architecture, filename]) => ({
      arch: architecture,
      filename,
      os: operatingSystem,
      path: `${version}/${filename}`,
      sha256: digest(binary),
      signature_path: `${version}/${filename}.sig`,
      size: binary.length,
    }),
  )
  const manifestPayload = {
    artifacts,
    product: 'locker-cli',
    protocol: {
      max_version: 1,
      min_version: 1,
      name: 'locker.sdk',
      transport: 'json-rpc-2.0-stdio',
    },
    schema: 'io.locker.cli.update-manifest',
    schema_version: 2,
    source_commit: sourceCommit,
    version,
  }
  if (options.mutateManifest) {
    options.mutateManifest(manifestPayload)
  }
  const envelope = (payload) => {
    const payloadBytes = module.canonicalJSON(payload)
    const signature = sign(null, payloadBytes, pair.privateKey)
    return Buffer.concat([
      module.canonicalJSON({
        algorithm: 'Ed25519',
        key_id: module.KEY_ID,
        payload: payloadBytes.toString('base64url'),
        schema: 'io.locker.cli.signed-envelope',
        schema_version: 2,
        signature: signature.toString('base64url'),
      }),
      Buffer.from('\n'),
    ])
  }
  const manifestBytes = envelope(manifestPayload)
  const latestPayload = {
    manifest: {
      path: `${version}/manifest.json`,
      sha256: digest(manifestBytes),
      size: manifestBytes.length,
    },
    product: 'locker-cli',
    schema: 'io.locker.cli.update-latest',
    schema_version: 2,
    source_commit: sourceCommit,
    version,
  }
  if (options.mutateLatest) {
    options.mutateLatest(latestPayload)
  }
  const latestBytes = envelope(latestPayload)
  if (options.mutateLatestEnvelope) {
    options.mutateLatestEnvelope(latestBytes)
  }
  const selected = artifacts.find(
    (artifact) =>
      artifact.os === identity.os && artifact.arch === identity.arch,
  )
  assert.ok(selected)
  const objects = new Map([
    [`${module.BASE_URL}latest.json`, latestBytes],
    [`${module.BASE_URL}${version}/manifest.json`, manifestBytes],
    [`${module.BASE_URL}${selected.path}`, binary],
    [`${module.BASE_URL}${selected.signature_path}`, artifactSignature],
  ])
  const calls = []
  const downloadBuffer = async (url, maximum, _timeout, expectedSize) => {
    calls.push(url)
    const value = objects.get(url)
    if (!value) {
      throw new Error(`unexpected fixture URL ${url}`)
    }
    assert.ok(value.length <= maximum)
    if (expectedSize !== undefined) {
      assert.equal(value.length, expectedSize)
    }
    return Buffer.from(value)
  }
  return {
    ...module,
    artifactSignature,
    binary,
    calls,
    downloadBuffer,
    identity,
    latestBytes,
    manifestBytes,
    objects,
    pair,
    publicKey,
    selected,
    trust,
    version,
  }
}

test('canonical shared fixture matches the language-neutral hashes', async () => {
  const { canonicalJSON } = await installer()
  const fixture = JSON.parse(
    await readFile(
      path.resolve('tests/fixtures/update-channel-v2.json'),
      'utf8',
    ),
  )
  assert.equal(
    digest(canonicalJSON(fixture.latest_payload)),
    'dd32ad36e2ac2fac72220ad8ad8b72da3200799d7d33e7c93f08aa5221b2b22c',
  )
  assert.equal(
    digest(canonicalJSON(fixture.manifest_payload)),
    'dbac1da6c487aac212fb9cf18cc547983749d226f4958de849d00d15116e6212',
  )
})

test('strict signed envelope rejects duplicate, float, depth and LF drift', async () => {
  const { canonicalJSON, parseStrictJSON, parseLatest, latestBytes, trust } =
    await signedChannel()
  assert.throws(() => parseStrictJSON('{"a":1,"a":1}'), /duplicate field/)
  assert.throws(() => parseStrictJSON('{"a":1.0}'), /floating-point/)
  assert.throws(
    () => parseStrictJSON(`${'['.repeat(65)}0${']'.repeat(65)}`),
    /nesting exceeds/,
  )
  assert.equal(
    canonicalJSON({ value: '\x7f' }).toString('ascii'),
    '{"value":"\\u007f"}',
  )
  assert.throws(() => canonicalJSON({ value: -0 }), /safe signed integers/)
  assert.throws(
    () => parseLatest(latestBytes.subarray(0, -1), trust),
    /canonical JSON plus one LF/,
  )
  const tampered = Buffer.from(latestBytes)
  tampered[tampered.length - 10] ^= 1
  assert.throws(() => parseLatest(tampered, trust))
})

test('platform mapping uses the five canonical international filenames', async () => {
  const { platformIdentity } = await installer()
  assert.deepEqual(platformIdentity('linux', 'x64'), {
    os: 'linux',
    arch: 'amd64',
    filename: 'locker-linux-amd64',
  })
  assert.deepEqual(platformIdentity('darwin', 'arm64'), {
    os: 'darwin',
    arch: 'arm64',
    filename: 'locker-darwin-arm64',
  })
  assert.throws(
    () => platformIdentity('win32', 'arm64'),
    /unsupported Locker CLI platform/,
  )
})

test('network fallback classification is narrow and TLS failures are hard', async () => {
  const updateModule = await installer()
  for (const status of [408, 425, 429, 500, 599]) {
    assert.ok(
      updateModule.responseStatusError(status) instanceof
        updateModule.UpdateNetworkError,
    )
  }
  for (const status of [301, 401, 404, 600]) {
    assert.ok(
      !(
        updateModule.responseStatusError(status) instanceof
        updateModule.UpdateNetworkError
      ),
    )
  }
  assert.ok(
    updateModule.classifyRequestError({ code: 'ETIMEDOUT' }) instanceof
      updateModule.UpdateNetworkError,
  )
  assert.ok(
    !(
      updateModule.classifyRequestError({
        code: 'CERT_HAS_EXPIRED',
      }) instanceof updateModule.UpdateNetworkError
    ),
  )
})

test('explicit CLI path bypasses trust metadata and network', async () => {
  const { installManagedCLI } = await installer()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locker-js-explicit-'))
  const cliPath = path.join(directory, 'locker')
  await writeFile(cliPath, 'explicit cli', { mode: 0o700 })
  const result = await installManagedCLI({
    explicitPath: cliPath,
    configurationPath: path.join(directory, 'missing.json'),
    downloadBuffer: async () => {
      throw new Error('network must not be called')
    },
  })
  assert.equal(result.path, path.resolve(cliPath))
  assert.equal(result.checked, false)
})

test('explicit CLI paths must be absolute', async () => {
  const { installManagedCLI } = await installer()
  await assert.rejects(
    installManagedCLI({ explicitPath: 'locker' }),
    /must be absolute/,
  )

  const { resolveCLIPath } = require('../../lib/cjs/src/cli/resolver.js')
  assert.throws(() => resolveCLIPath('locker'), /must be absolute/)
})

test(
  'explicit CLI path must not be a symbolic link',
  { skip: process.platform === 'win32' },
  async () => {
    const { installManagedCLI } = await installer()
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'locker-js-explicit-link-'),
    )
    const binary = path.join(directory, 'locker-real')
    const link = path.join(directory, 'locker')
    await writeFile(binary, 'explicit cli', { mode: 0o700 })
    await symlink(binary, link)
    await assert.rejects(installManagedCLI({ explicitPath: link }), /non-link/)
  },
)

test(
  'explicit CLI path must be executable on POSIX',
  { skip: process.platform === 'win32' },
  async () => {
    const { installManagedCLI } = await installer()
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'locker-js-non-executable-'),
    )
    const cliPath = path.join(directory, 'locker')
    await writeFile(cliPath, 'not executable', { mode: 0o600 })
    await chmod(cliPath, 0o600)
    await assert.rejects(
      installManagedCLI({ explicitPath: cliPath }),
      /executable/,
    )
  },
)

test('installs a signed release atomically and skips network for six hours', async () => {
  const fixture = await signedChannel()
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'locker-js-signed-'))
  const first = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 1_000_000,
    downloadBuffer: fixture.downloadBuffer,
  })
  assert.equal(first.reused, false)
  assert.equal(first.checked, true)
  assert.equal(path.basename(path.dirname(first.path)), fixture.version)
  assert.deepEqual(await readFile(first.path), fixture.binary)
  assert.deepEqual(
    (await readdir(path.dirname(first.path))).sort(),
    [
      fixture.selected.filename,
      `${fixture.selected.filename}.sig`,
      'manifest.json',
    ].sort(),
  )
  const second = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 1_000_000 + 21_599,
    downloadBuffer: async () => {
      throw new Error('fresh check must not use network')
    },
  })
  assert.equal(second.path, first.path)
  assert.equal(second.checked, false)
  assert.equal(fixture.calls.length, 4)
})

test('due check fetches signed latest and manifest without pinning a version', async () => {
  const fixture = await signedChannel()
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'locker-js-due-'))
  await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 2_000_000,
    downloadBuffer: fixture.downloadBuffer,
  })
  fixture.calls.length = 0
  const current = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 2_000_000 + 21_600,
    downloadBuffer: fixture.downloadBuffer,
  })
  assert.equal(current.reused, true)
  assert.equal(current.checked, true)
  assert.deepEqual(fixture.calls, [
    `${fixture.BASE_URL}latest.json`,
    `${fixture.BASE_URL}${fixture.version}/manifest.json`,
  ])
})

test('transport failure at any update step falls back only to verified cache', async () => {
  const fixture = await signedChannel()
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-offline-'),
  )
  const installed = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 3_000_000,
    downloadBuffer: fixture.downloadBuffer,
  })
  let calls = 0
  const fallback = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    forceCheck: true,
    nowSeconds: 3_000_001,
    downloadBuffer: async (url) => {
      calls += 1
      if (url.endsWith('latest.json')) {
        return Buffer.from(fixture.latestBytes)
      }
      throw new fixture.UpdateNetworkError('offline')
    },
  })
  assert.equal(calls, 2)
  assert.equal(fallback.path, installed.path)
  assert.equal(fallback.checked, false)
  const retryState = JSON.parse(
    await readFile(path.join(installRoot, 'locker.check.json'), 'utf8'),
  )
  assert.equal(retryState.checked_at_unix, 3_000_000)
  assert.equal(retryState.retry_after_unix, 3_000_061)
  const beforeRetry = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 3_000_060,
    downloadBuffer: async () => {
      calls += 1
      throw new fixture.UpdateNetworkError('offline')
    },
  })
  assert.equal(beforeRetry.path, installed.path)
  assert.equal(calls, 2)
  await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 3_000_061,
    downloadBuffer: async () => {
      calls += 1
      throw new fixture.UpdateNetworkError('offline')
    },
  })
  assert.equal(calls, 3)

  const empty = await mkdtemp(path.join(os.tmpdir(), 'locker-js-empty-'))
  await assert.rejects(
    fixture.installManagedCLI({
      trust: fixture.trust,
      identity: fixture.identity,
      installRoot: empty,
      downloadBuffer: async () => {
        throw new fixture.UpdateNetworkError('offline')
      },
    }),
    /offline/,
  )
})

test('signature, hash, header and signed-metadata failures never use cache fallback', async () => {
  const initial = await signedChannel()
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-integrity-'),
  )
  const installed = await initial.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    nowSeconds: 4_000_000,
    downloadBuffer: initial.downloadBuffer,
  })

  const invalidSignature = await signedChannel({
    pair: initial.pair,
    version: '2.0.8',
    identity: initial.identity,
    mutateArtifactSignature: true,
  })
  await assert.rejects(
    invalidSignature.installManagedCLI({
      trust: initial.trust,
      identity: initial.identity,
      installRoot,
      forceCheck: true,
      nowSeconds: 4_000_001,
      downloadBuffer: invalidSignature.downloadBuffer,
    }),
    /signature verification/,
  )
  const pointer = JSON.parse(
    await readFile(path.join(installRoot, 'locker.current.json'), 'utf8'),
  )
  assert.equal(pointer.version, initial.version)
  assert.deepEqual(await readFile(installed.path), initial.binary)

  const badHeader = await signedChannel({
    pair: initial.pair,
    version: '2.0.9',
    identity: initial.identity,
    binary: Buffer.alloc(128, 0x41),
  })
  await assert.rejects(
    badHeader.installManagedCLI({
      trust: initial.trust,
      identity: initial.identity,
      installRoot,
      forceCheck: true,
      nowSeconds: 4_000_002,
      downloadBuffer: badHeader.downloadBuffer,
    }),
    /artifact is not|architecture is invalid/,
  )
})

test('rollback and same-version equivocation fail closed', async () => {
  const initial = await signedChannel()
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-rollback-'),
  )
  await initial.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    nowSeconds: 5_000_000,
    downloadBuffer: initial.downloadBuffer,
  })
  const rollback = await signedChannel({
    pair: initial.pair,
    version: '2.0.6',
    identity: initial.identity,
  })
  await assert.rejects(
    rollback.installManagedCLI({
      trust: initial.trust,
      identity: initial.identity,
      installRoot,
      forceCheck: true,
      nowSeconds: 5_000_001,
      downloadBuffer: rollback.downloadBuffer,
    }),
    /rollback/,
  )
  const mutation = await signedChannel({
    pair: initial.pair,
    version: initial.version,
    sourceCommit: 'b'.repeat(40),
    identity: initial.identity,
  })
  await assert.rejects(
    mutation.installManagedCLI({
      trust: initial.trust,
      identity: initial.identity,
      installRoot,
      forceCheck: true,
      nowSeconds: 5_000_002,
      downloadBuffer: mutation.downloadBuffer,
    }),
    /mutated an (?:accepted|existing) version/,
  )
})

test('signed latest high-water survives a downstream transport failure', async () => {
  const initial = await signedChannel({ version: '2.0.7' })
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-high-water-'),
  )
  const installed = await initial.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    nowSeconds: 5_100_000,
    downloadBuffer: initial.downloadBuffer,
  })
  const accepted = await signedChannel({
    pair: initial.pair,
    version: '2.0.8',
    sourceCommit: 'b'.repeat(40),
    identity: initial.identity,
  })
  const fallback = await accepted.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    forceCheck: true,
    nowSeconds: 5_100_001,
    downloadBuffer: async (url) => {
      if (url === `${accepted.BASE_URL}latest.json`) {
        return Buffer.from(accepted.latestBytes)
      }
      throw new accepted.UpdateNetworkError('offline after signed latest')
    },
  })
  assert.equal(fallback.path, installed.path)
  const acceptedState = JSON.parse(
    await readFile(path.join(installRoot, 'locker.accepted.json'), 'utf8'),
  )
  assert.equal(acceptedState.version, '2.0.8')
  assert.equal(acceptedState.source_commit, 'b'.repeat(40))

  for (const candidate of [
    await signedChannel({
      pair: initial.pair,
      version: '2.0.7',
      identity: initial.identity,
    }),
    await signedChannel({
      pair: initial.pair,
      version: '2.0.8',
      sourceCommit: 'c'.repeat(40),
      identity: initial.identity,
    }),
  ]) {
    await assert.rejects(
      candidate.installManagedCLI({
        trust: initial.trust,
        identity: initial.identity,
        installRoot,
        forceCheck: true,
        nowSeconds: 5_100_002,
        downloadBuffer: candidate.downloadBuffer,
      }),
      /rollback|mutated an accepted version/,
    )
  }
})

test('pending accepted release resumes after an interrupted force check', async () => {
  const initial = await signedChannel({ version: '2.0.7' })
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-interrupted-'),
  )
  await initial.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    nowSeconds: 5_200_000,
    downloadBuffer: initial.downloadBuffer,
  })
  const pending = await signedChannel({
    pair: initial.pair,
    version: '2.0.8',
    identity: initial.identity,
  })
  await assert.rejects(
    pending.installManagedCLI({
      trust: initial.trust,
      identity: initial.identity,
      installRoot,
      forceCheck: true,
      nowSeconds: 5_200_001,
      downloadBuffer: async (url) => {
        if (url === `${pending.BASE_URL}latest.json`) {
          return Buffer.from(pending.latestBytes)
        }
        throw new Error('simulated interruption after accepted latest')
      },
    }),
    /simulated interruption/,
  )

  pending.calls.length = 0
  const installed = await pending.installManagedCLI({
    trust: initial.trust,
    identity: initial.identity,
    installRoot,
    nowSeconds: 5_200_001,
    downloadBuffer: pending.downloadBuffer,
  })
  assert.equal(installed.reused, false)
  assert.match(installed.path, /2\.0\.8/u)
  assert.equal(pending.calls[0], `${pending.BASE_URL}latest.json`)
})

test('concurrent installers serialize publication and download once', async () => {
  const fixture = await signedChannel()
  const installRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-concurrent-'),
  )
  let artifactDownloads = 0
  let openGate
  let announce
  const started = new Promise((resolve) => {
    announce = resolve
  })
  const gate = new Promise((resolve) => {
    openGate = resolve
  })
  const download = async (...args) => {
    if (args[0] === `${fixture.BASE_URL}${fixture.selected.path}`) {
      artifactDownloads += 1
      announce()
      await gate
    }
    return await fixture.downloadBuffer(...args)
  }
  const options = {
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds: 6_000_000,
    downloadBuffer: download,
  }
  const first = fixture.installManagedCLI(options)
  await started
  const second = fixture.installManagedCLI(options)
  await new Promise((resolve) => setTimeout(resolve, 100))
  openGate()
  const results = await Promise.all([first, second])
  assert.equal(artifactDownloads, 1)
  assert.deepEqual(results.map((result) => result.reused).sort(), [false, true])
})

test('runtime resolver invokes signed updater and ignores legacy canonical binary', async () => {
  const fixture = await signedChannel()
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-runtime-home-'),
  )
  const packageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-runtime-package-'),
  )
  const installRoot = path.join(homeDirectory, '.locker', 'sdk-cli', 'nodejs')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const installed = await fixture.installManagedCLI({
    trust: fixture.trust,
    identity: fixture.identity,
    installRoot,
    nowSeconds,
    downloadBuffer: fixture.downloadBuffer,
  })
  await writeFile(
    path.join(packageRoot, 'locker-cli-release.json'),
    `${JSON.stringify({
      schema_version: 2,
      base_url: fixture.BASE_URL,
      key_id: fixture.KEY_ID,
      public_key: fixture.publicKey.toString('base64url'),
      check_interval_seconds: fixture.CHECK_INTERVAL_SECONDS,
    })}\n`,
    'utf8',
  )
  const { resolveDefaultCLIPath } = require('../../lib/cjs/src/cli/resolver.js')
  assert.equal(
    resolveDefaultCLIPath({
      environment: {},
      homeDirectory,
      packageRoot,
      installerScript: path.resolve('scripts/install-cli.mjs'),
      nowMs: nowSeconds * 1000,
    }),
    installed.path,
  )
})

test('runtime resolver binds trust and helper to its own package, not cwd', async () => {
  const updateModule = await installer()
  const identity = updateModule.platformIdentity()
  const packageRoot = path.resolve('.')
  const hostileRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-hostile-cwd-'),
  )
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-bound-home-'),
  )
  const releaseDirectory = path.join(
    homeDirectory,
    '.locker',
    'sdk-cli',
    'nodejs',
    'releases',
    '2.0.8',
  )
  const binaryPath = path.join(releaseDirectory, identity.filename)
  const helperPath = path.join(hostileRoot, 'managed-helper.mjs')
  await mkdir(releaseDirectory, { recursive: true })
  await writeFile(binaryPath, 'verified test binary', 'utf8')
  await chmod(binaryPath, 0o700)
  await writeFile(
    path.join(hostileRoot, 'package.json'),
    `${JSON.stringify({
      name: 'lockersm',
      version: '2.0.0',
      exports: {
        '.': {
          require: './missing-cjs.js',
          import: './missing-esm.js',
        },
      },
    })}\n`,
    'utf8',
  )
  await writeFile(
    path.join(hostileRoot, 'locker-cli-release.json'),
    `${JSON.stringify({
      schema_version: 2,
      base_url: updateModule.BASE_URL,
      key_id: updateModule.KEY_ID,
      public_key: '',
      check_interval_seconds: updateModule.CHECK_INTERVAL_SECONDS,
    })}\n`,
    'utf8',
  )
  await writeFile(
    helperPath,
    [
      "import process from 'node:process'",
      `const expectedRoot = ${JSON.stringify(packageRoot)}`,
      `const binaryPath = ${JSON.stringify(binaryPath)}`,
      "const rootIndex = process.argv.indexOf('--package-root')",
      'if (rootIndex < 0 || process.argv[rootIndex + 1] !== expectedRoot) {',
      '  process.exit(17)',
      '}',
      'process.stdout.write(JSON.stringify({',
      '  checked: true,',
      '  next_check_at_unix: Math.floor(Date.now() / 1000) + 3600,',
      '  path: binaryPath,',
      '  reused: false,',
      '}))',
      '',
    ].join('\n'),
    'utf8',
  )

  const runners = [
    `const module = require(${JSON.stringify(
      path.join(packageRoot, 'lib', 'cjs', 'src', 'cli', 'resolver.js'),
    )}); process.stdout.write(module.resolveDefaultCLIPath(${JSON.stringify({
      environment: {},
      homeDirectory,
      installerScript: helperPath,
      nowMs: Date.now(),
    })}))`,
    `import(${JSON.stringify(
      pathToFileURL(
        path.join(packageRoot, 'lib', 'esm', 'src', 'cli', 'resolver.js'),
      ).href,
    )}).then((module) => process.stdout.write(module.resolveDefaultCLIPath(${JSON.stringify(
      {
        environment: {},
        homeDirectory,
        installerScript: helperPath,
        nowMs: Date.now(),
      },
    )}))).catch((error) => { console.error(error); process.exitCode = 1 })`,
  ]

  for (const runner of runners) {
    const result = spawnSync(process.execPath, ['-e', runner], {
      cwd: hostileRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, binaryPath)
  }
})

test('unprovisioned trust fails closed without ambient PATH fallback', async () => {
  const updateModule = await installer()
  const packageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-blank-trust-'),
  )
  const trustPath = path.join(packageRoot, 'locker-cli-release.json')
  await writeFile(
    trustPath,
    `${JSON.stringify({
      schema_version: 2,
      base_url: updateModule.BASE_URL,
      key_id: updateModule.KEY_ID,
      public_key: '',
      check_interval_seconds: updateModule.CHECK_INTERVAL_SECONDS,
    })}\n`,
    'utf8',
  )
  await assert.rejects(
    updateModule.loadReleaseTrust(trustPath),
    /no production trust root/,
  )
  const { resolveDefaultCLIPath } = require('../../lib/cjs/src/cli/resolver.js')
  assert.throws(
    () =>
      resolveDefaultCLIPath({
        environment: { PATH: packageRoot },
        packageRoot,
        homeDirectory: path.join(packageRoot, 'home'),
      }),
    /release trust is unprovisioned/u,
  )
})

test('importing the package has no download or cache side effect', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locker-js-import-'))
  const before = await readdir(directory)
  assert.deepEqual(before, [])
  const imported = require('../../lib/cjs/index.js')
  assert.equal(typeof imported.Locker, 'function')
  assert.deepEqual(await readdir(directory), [])
})
