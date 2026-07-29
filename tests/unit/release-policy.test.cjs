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

test('prepareRelease versions one merge and rejects direct main commits', async (t) => {
  const { prepareRelease } = await releaseModule()
  const repository = await mkdtemp(path.join(os.tmpdir(), 'locker-js-policy-'))
  t.after(async () => {
    await rm(repository, { force: true, recursive: true })
  })
  await mkdir(path.join(repository, 'scripts'))
  await cp('package.json', path.join(repository, 'package.json'))
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Release Test')
  git(repository, 'config', 'user.email', 'release@test.invalid')
  git(repository, 'config', 'commit.gpgsign', 'false')
  git(repository, 'add', '.')
  git(repository, 'commit', '-m', 'baseline')
  const baseline = git(repository, 'rev-parse', 'HEAD')
  git(repository, 'checkout', '-b', 'feature')
  await writeFile(
    path.join(repository, 'scripts', 'release-policy.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        baseline_commit: baseline,
        first_release_distance: 1,
        mainline_mode: 'merge_commit',
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(path.join(repository, 'feature.txt'), 'feature\n')
  git(repository, 'add', 'feature.txt', 'scripts/release-policy.json')
  git(repository, 'commit', '-m', 'feature one')
  await writeFile(path.join(repository, 'feature-two.txt'), 'feature two\n')
  git(repository, 'add', 'feature-two.txt')
  git(repository, 'commit', '-m', 'feature two')
  git(repository, 'checkout', 'main')
  git(repository, 'merge', '--no-ff', 'feature', '-m', 'merge feature')
  const merge = git(repository, 'rev-parse', 'HEAD')

  const release = await prepareRelease(repository, merge)
  assert.equal(release.version, '2.0.0')
  assert.equal(release.firstParentDistance, 1)
  assert.equal(release.predecessorTag, '')
  assert.equal(release.predecessorCommit, '')

  git(repository, 'tag', 'v2.0.0', baseline)
  await assert.rejects(
    prepareRelease(repository, merge),
    /does not point to the first release merge/u,
  )
  git(repository, 'tag', '-d', 'v2.0.0')

  git(repository, 'checkout', '-b', 'feature-second-release')
  await writeFile(path.join(repository, 'second-release.txt'), 'second\n')
  git(repository, 'add', 'second-release.txt')
  git(repository, 'commit', '-m', 'second release')
  git(repository, 'checkout', 'main')
  git(
    repository,
    'merge',
    '--no-ff',
    'feature-second-release',
    '-m',
    'merge second',
  )
  const secondMerge = git(repository, 'rev-parse', 'HEAD')
  let secondRelease = await prepareRelease(repository, secondMerge)
  assert.equal(secondRelease.predecessorTag, 'v2.0.0')
  assert.equal(secondRelease.predecessorCommit, merge)
  git(repository, 'tag', 'v2.0.0', merge)
  secondRelease = await prepareRelease(repository, secondMerge)
  assert.equal(secondRelease.version, '2.0.1')
  assert.equal(secondRelease.firstParentDistance, 2)
  assert.equal(secondRelease.predecessorTag, 'v2.0.0')
  assert.equal(secondRelease.predecessorCommit, merge)

  await writeFile(path.join(repository, 'direct.txt'), 'direct\n')
  git(repository, 'add', 'direct.txt')
  git(repository, 'commit', '-m', 'direct')
  const direct = git(repository, 'rev-parse', 'HEAD')
  await assert.rejects(prepareRelease(repository, direct), /two-parent merge/u)
})

test('waitForPredecessor rejects missing and mispointed remote tags', async (t) => {
  const { waitForPredecessor } = await releaseModule()
  const repository = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-predecessor-'),
  )
  const remoteRoot = await mkdtemp(
    path.join(os.tmpdir(), 'locker-js-predecessor-remote-'),
  )
  const remote = path.join(remoteRoot, 'origin.git')
  t.after(async () => {
    await rm(repository, { force: true, recursive: true })
    await rm(remoteRoot, { force: true, recursive: true })
  })
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Release Test')
  git(repository, 'config', 'user.email', 'release@test.invalid')
  git(repository, 'config', 'commit.gpgsign', 'false')
  await writeFile(path.join(repository, 'first.txt'), 'first\n')
  git(repository, 'add', 'first.txt')
  git(repository, 'commit', '-m', 'first')
  const first = git(repository, 'rev-parse', 'HEAD')
  await writeFile(path.join(repository, 'second.txt'), 'second\n')
  git(repository, 'add', 'second.txt')
  git(repository, 'commit', '-m', 'second')
  const second = git(repository, 'rev-parse', 'HEAD')
  git(remoteRoot, 'init', '--bare', remote)
  git(repository, 'remote', 'add', 'origin', remote)
  git(repository, 'push', 'origin', 'main')

  await waitForPredecessor(repository, '', '', 1, 0)
  await assert.rejects(
    waitForPredecessor(repository, 'v2.0.0', first, 1, 0),
    /not available/u,
  )
  git(repository, 'tag', 'v2.0.0', first)
  git(repository, 'push', 'origin', 'v2.0.0')
  await waitForPredecessor(repository, 'v2.0.0', first, 1, 0)
  await assert.rejects(
    waitForPredecessor(repository, 'v2.0.0', second, 1, 0),
    /another commit/u,
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
