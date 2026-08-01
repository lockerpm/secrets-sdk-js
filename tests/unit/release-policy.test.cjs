'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

function git(repository, ...arguments_) {
  const result = spawnSync('git', ['-C', repository, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(
    result.status,
    0,
    `git ${arguments_.join(' ')} failed: ${result.stderr}`,
  )
  return result.stdout.trim()
}

async function releaseModule() {
  return await import(pathToFileURL(path.resolve('scripts/release.mjs')).href)
}

test('GitLab release coordinates bind the job token to one HTTPS origin', async () => {
  const { gitLabReleaseCoordinates } = await releaseModule()
  assert.deepEqual(
    gitLabReleaseCoordinates(
      'https://git.example.test:443/api/v4',
      'https://git.example.test/locker/secrets-sdk-js/',
      '123',
    ),
    {
      endpoint: 'https://git.example.test/api/v4/projects/123/releases',
      origin: 'https://git.example.test',
      projectBase: 'https://git.example.test/locker/secrets-sdk-js',
    },
  )

  for (const [api, project, projectID] of [
    [
      'http://git.example.test/api/v4',
      'https://git.example.test/project',
      '123',
    ],
    [
      'https://attacker.example/api/v4',
      'https://git.example.test/project',
      '123',
    ],
    [
      'https://git.example.test:444/api/v4',
      'https://git.example.test/project',
      '123',
    ],
    [
      'https://token@git.example.test/api/v4',
      'https://git.example.test/project',
      '123',
    ],
    [
      'https://git.example.test/api/v4?target=attacker',
      'https://git.example.test/project',
      '123',
    ],
    [
      'https://git.example.test/api/v4',
      'https://git.example.test/project#fragment',
      '123',
    ],
    [
      'https://git.example.test/api/v4',
      'https://git.example.test/project',
      '../123',
    ],
  ]) {
    assert.throws(
      () => gitLabReleaseCoordinates(api, project, projectID),
      /GitLab/u,
    )
  }
})

async function initRepositoryWithRemoteMain(repository, remote) {
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Release Test')
  git(repository, 'config', 'user.email', 'release@test.invalid')
  git(repository, 'config', 'commit.gpgsign', 'false')
  await cp('package.json', path.join(repository, 'package.json'))
  git(repository, 'add', 'package.json')
  git(repository, 'commit', '-m', 'baseline')
  git(remote.root, 'init', '--bare', remote.path)
  git(repository, 'remote', 'add', 'origin', remote.path)
  git(repository, 'push', 'origin', 'main')
  git(repository, 'fetch', 'origin')
}

test('prepareRelease derives the version from the tag and requires it to be on main', async (t) => {
  const { prepareRelease } = await releaseModule()
  const repository = await mkdtemp(path.join(os.tmpdir(), 'locker-js-policy-'))
  const remoteRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-policy-remote-'),
  )
  const remote = { root: remoteRoot, path: path.join(remoteRoot, 'origin.git') }
  t.after(async () => {
    await rm(repository, { force: true, recursive: true })
    await rm(remoteRoot, { force: true, recursive: true })
  })
  await initRepositoryWithRemoteMain(repository, remote)
  const main = git(repository, 'rev-parse', 'HEAD')

  const release = await prepareRelease(repository, 'v2.0.0', main)
  assert.equal(release.version, '2.0.0')
  assert.equal(release.tag, 'v2.0.0')

  await assert.rejects(
    prepareRelease(repository, 'v9.9.9', main),
    /does not match package\.json version/u,
  )

  git(repository, 'checkout', '-b', 'feature')
  await writeFile(path.join(repository, 'feature.txt'), 'feature\n')
  git(repository, 'add', 'feature.txt')
  git(repository, 'commit', '-m', 'feature')
  const offMain = git(repository, 'rev-parse', 'HEAD')
  await assert.rejects(
    prepareRelease(repository, 'v2.0.0', offMain),
    /not part of the main history/u,
  )
})

test('stageVersion changes only the isolated tracked-source copy', async (t) => {
  const { stageVersion } = await releaseModule()
  const output = path.resolve('.release-policy-test-output')
  await rm(output, { force: true, recursive: true })
  t.after(async () => {
    await rm(output, { force: true, recursive: true })
  })
  await stageVersion(path.resolve('.'), output, '2.0.7')
  const stagedPackage = JSON.parse(
    await readFile(path.join(output, 'package.json'), 'utf8'),
  )
  const sourcePackage = JSON.parse(await readFile('package.json', 'utf8'))
  const stagedVersion = await readFile(
    path.join(output, 'src', 'version.ts'),
    'utf8',
  )
  assert.equal(stagedPackage.version, '2.0.7')
  assert.equal(sourcePackage.version, '2.0.0')
  assert.match(stagedVersion, /SDK_VERSION = '2\.0\.7'/u)
})
