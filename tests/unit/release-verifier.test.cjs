'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
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
    license: 'ISC',
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
        license: 'ISC',
      },
    },
  })
  await writeJSON(path.join(root, 'locker-cli-release.json'), releaseTrust)
  await writeFile(path.join(root, 'LICENSE'), 'ISC License\n\nFixture terms.\n')
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
    tag: '2.0.0',
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
  const releaseTrust = JSON.parse(
    await readFile('locker-cli-release.json', 'utf8'),
  )
  const license = await readFile('LICENSE')
  await verifyArtifact(
    path.join(output, `lockersm-${packageJSON.version}.tgz`),
    packageJSON,
    releaseTrust,
    license,
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
        tag: '2.0.1',
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
        tag: '2.0.0',
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
        tag: '2.0.0',
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
        tag: '2.0.0',
        releasePublicKey: fixture.publicKey,
      }),
      /must not be empty/u,
    )
  })
})
