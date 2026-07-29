'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { gunzipSync, gzipSync } = require('node:zlib')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

async function verifier() {
  return await import(
    pathToFileURL(path.resolve('scripts/verify-release.mjs')).href
  )
}

async function writeJSON(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function tarEntry(name, contents) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = 0x30
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const value of header) {
    checksum += value
  }
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  const padding = Buffer.alloc((512 - (contents.length % 512)) % 512)
  return Buffer.concat([header, contents, padding])
}

function firstTarTerminator(archive) {
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) {
      return offset
    }
    const sizeText = header
      .subarray(124, 136)
      .toString('ascii')
      .replace(/\0.*$/u, '')
      .trim()
    const size = Number.parseInt(sizeText, 8)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error('fixture tar terminator is missing')
}

async function releaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locker-js-release-'))
  const version = '2.0.0'
  const publicKey = Buffer.alloc(32, 0x5a).toString('base64url')
  const releaseTrust = {
    schema_version: 2,
    base_url: 'https://files.locker.io/cli/releases/',
    key_id: 'locker-cli-release-v1',
    public_key: publicKey,
    check_interval_seconds: 21_600,
  }
  const packageJSON = {
    name: 'lockersm',
    version,
    description: 'Fixture',
    exports: {},
    types: './index.d.ts',
    main: './index.js',
    module: './index.js',
    bin: {},
    files: [],
    engines: { node: '^22.20.0 || ^24.0.0' },
    repository: { type: 'git', url: 'https://example.test/locker.git' },
    homepage: 'https://locker.io',
    bugs: { url: 'https://example.test/issues' },
    scripts: {},
    author: 'CyStack',
    license: 'Apache-2.0',
    devDependencies: {},
  }
  await writeJSON(path.join(root, 'package.json'), packageJSON)
  await writeJSON(path.join(root, 'package-lock.json'), {
    name: 'lockersm',
    version,
    lockfileVersion: 2,
    requires: true,
    dependencies: {},
    packages: {
      '': {
        name: 'lockersm',
        version,
        license: 'Apache-2.0',
      },
    },
  })
  await writeJSON(path.join(root, 'locker-cli-release.json'), releaseTrust)
  await writeFile(
    path.join(root, 'LICENSE'),
    'Apache License\nVersion 2.0\n\nFixture terms.\n',
  )
  return { root, publicKey, releaseTrust }
}

test('release verifier accepts matching independent trust root', async (t) => {
  const { verifyRelease } = await verifier()
  const fixture = await releaseFixture()
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true })
  })
  await verifyRelease({
    root: fixture.root,
    tag: 'v2.0.0',
    releasePublicKey: fixture.publicKey,
  })
})

test('release verifier validates the exact npm pack artifact', async (t) => {
  const { verifyArtifact } = await verifier()
  const output = await mkdtemp(path.join(os.tmpdir(), 'locker-js-package-'))
  t.after(async () => {
    await rm(output, { force: true, recursive: true })
  })
  const npm = process.env.npm_execpath
    ? process.env.npm_execpath
    : path.join(
        path.dirname(process.execPath),
        'node_modules/npm/bin/npm-cli.js',
      )
  const packed = spawnSync(
    process.execPath,
    [npm, 'pack', '--ignore-scripts', '--pack-destination', output],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      windowsHide: true,
    },
  )
  assert.equal(
    packed.status,
    0,
    `npm pack failed: ${packed.error ?? ''}\n${packed.stdout}\n${packed.stderr}`,
  )
  const packageJSON = JSON.parse(await readFile('package.json', 'utf8'))
  await verifyArtifact(
    path.join(output, `lockersm-${packageJSON.version}.tgz`),
    path.resolve('.'),
    packageJSON,
  )

  const artifact = path.join(output, `lockersm-${packageJSON.version}.tgz`)
  const original = gunzipSync(await readFile(artifact))
  const terminator = firstTarTerminator(original)
  const injected = Buffer.concat([
    original.subarray(0, terminator),
    tarEntry('package/lib/evil.js', Buffer.from('malicious\n')),
    Buffer.alloc(1024),
  ])
  await writeFile(artifact, gzipSync(injected))
  await assert.rejects(
    verifyArtifact(artifact, path.resolve('.'), packageJSON),
    /file list differs/u,
  )

  const trailingData = Buffer.concat([original, Buffer.from([0x41])])
  await writeFile(artifact, gzipSync(trailingData))
  await assert.rejects(
    verifyArtifact(artifact, path.resolve('.'), packageJSON),
    /nonzero trailer/u,
  )
})

test('release verifier fails closed on trust, tag and license drift', async (t) => {
  const { verifyRelease } = await verifier()

  await t.test('tag mismatch', async (t) => {
    const fixture = await releaseFixture()
    t.after(async () => {
      await rm(fixture.root, { force: true, recursive: true })
    })
    await assert.rejects(
      verifyRelease({
        root: fixture.root,
        tag: 'v2.0.1',
        releasePublicKey: fixture.publicKey,
      }),
      /exactly equal/u,
    )
  })

  await t.test('independent key mismatch', async (t) => {
    const fixture = await releaseFixture()
    t.after(async () => {
      await rm(fixture.root, { force: true, recursive: true })
    })
    await assert.rejects(
      verifyRelease({
        root: fixture.root,
        tag: 'v2.0.0',
        releasePublicKey: Buffer.alloc(32, 0x33).toString('base64url'),
      }),
      /independent protected key/u,
    )
  })

  await t.test('blank packaged key', async (t) => {
    const fixture = await releaseFixture()
    t.after(async () => {
      await rm(fixture.root, { force: true, recursive: true })
    })
    fixture.releaseTrust.public_key = ''
    await writeJSON(
      path.join(fixture.root, 'locker-cli-release.json'),
      fixture.releaseTrust,
    )
    await assert.rejects(
      verifyRelease({
        root: fixture.root,
        tag: 'v2.0.0',
        releasePublicKey: fixture.publicKey,
      }),
      /invalid or unprovisioned/u,
    )
  })

  await t.test('empty license', async (t) => {
    const fixture = await releaseFixture()
    t.after(async () => {
      await rm(fixture.root, { force: true, recursive: true })
    })
    await writeFile(path.join(fixture.root, 'LICENSE'), ' \n')
    await assert.rejects(
      verifyRelease({
        root: fixture.root,
        tag: 'v2.0.0',
        releasePublicKey: fixture.publicKey,
      }),
      /must not be empty/u,
    )
  })
})
