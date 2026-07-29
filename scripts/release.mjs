import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const tagPattern = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const projectIDPattern = /^[1-9][0-9]*$/u
const maxResponseBytes = 2 * 1024 * 1024
const npmReleaseEndpoint = 'https://registry.npmjs.org/lockersm/'

export class ReleaseError extends Error {}

function git(repository, ...arguments_) {
  const result = spawnSync('git', ['-C', repository, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new ReleaseError(
      (result.stderr || result.stdout || 'git command failed').trim(),
    )
  }
  return result.stdout.trim()
}

function requireExactFields(value, fields, label) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new ReleaseError(`${label} fields are invalid`)
  }
}

async function readRegularJSON(file, fields, label) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxResponseBytes) {
    throw new ReleaseError(`${label} must be a bounded regular file`)
  }
  let value
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
  } catch (cause) {
    throw new ReleaseError(`${label} is invalid JSON`, { cause })
  }
  requireExactFields(value, fields, label)
  return value
}

async function loadPolicy(repository) {
  const policy = await readRegularJSON(
    path.join(repository, 'scripts', 'release-policy.json'),
    [
      'schema_version',
      'baseline_commit',
      'first_release_distance',
      'mainline_mode',
    ],
    'release policy',
  )
  if (
    policy.schema_version !== 1 ||
    !commitPattern.test(policy.baseline_commit) ||
    policy.first_release_distance !== 1 ||
    policy.mainline_mode !== 'merge_commit'
  ) {
    throw new ReleaseError('release policy values are invalid')
  }
  return policy
}

function localTagCommit(repository, tag) {
  const result = spawnSync(
    'git',
    [
      '-C',
      repository,
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/tags/${tag}^{commit}`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status === 1) {
    return undefined
  }
  if (result.status !== 0 || !commitPattern.test(result.stdout.trim())) {
    throw new ReleaseError('cannot inspect the local release tag')
  }
  return result.stdout.trim()
}

export async function prepareRelease(repository, commit) {
  if (!commitPattern.test(commit)) {
    throw new ReleaseError('release commit must be a full object ID')
  }
  const policy = await loadPolicy(repository)
  const packageJSON = await readRegularJSON(
    path.join(repository, 'package.json'),
    [
      'name',
      'version',
      'description',
      'exports',
      'types',
      'main',
      'module',
      'bin',
      'files',
      'engines',
      'repository',
      'homepage',
      'bugs',
      'scripts',
      'author',
      'license',
      'devDependencies',
    ],
    'package.json',
  )
  if (
    packageJSON.name !== 'lockersm' ||
    !versionPattern.test(packageJSON.version)
  ) {
    throw new ReleaseError('package release-line version is invalid')
  }
  if (git(repository, 'rev-parse', '--verify', 'HEAD') !== commit) {
    throw new ReleaseError('release commit must equal checked-out HEAD')
  }
  if (
    git(repository, 'status', '--porcelain=v1', '--untracked-files=no') !== ''
  ) {
    throw new ReleaseError('release checkout contains tracked changes')
  }
  git(repository, 'cat-file', '-e', `${policy.baseline_commit}^{commit}`)
  const ancestor = spawnSync(
    'git',
    [
      '-C',
      repository,
      'merge-base',
      '--is-ancestor',
      policy.baseline_commit,
      commit,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (ancestor.status !== 0) {
    throw new ReleaseError(
      'release commit is not descended from the policy baseline',
    )
  }
  const history = git(
    repository,
    'rev-list',
    '--first-parent',
    '--reverse',
    '--parents',
    `${policy.baseline_commit}..${commit}`,
  )
    .split(/\r?\n/u)
    .filter(Boolean)
  if (history.length < policy.first_release_distance) {
    throw new ReleaseError('release commit predates the first release')
  }
  const historyFields = history.map((line) => line.trim().split(/\s+/u))
  if (historyFields.some((fields) => fields.length !== 3)) {
    throw new ReleaseError(
      'every release-line commit must be a two-parent merge commit',
    )
  }
  if (historyFields[0][1] !== policy.baseline_commit) {
    throw new ReleaseError(
      "release policy baseline is not the first release merge's first parent",
    )
  }
  if (historyFields.at(-1)[0] !== commit) {
    throw new ReleaseError(
      'release commit is not the newest first-parent release',
    )
  }
  const [, major, minor, basePatch] = packageJSON.version.match(versionPattern)
  const version = `${major}.${minor}.${
    Number(basePatch) + history.length - policy.first_release_distance
  }`
  const baseTag = `v${packageJSON.version}`
  const taggedCommit = localTagCommit(repository, baseTag)
  const firstReleaseCommit = historyFields[0][0]
  if (taggedCommit && taggedCommit !== firstReleaseCommit) {
    throw new ReleaseError(
      `base tag ${baseTag} does not point to the first release merge`,
    )
  }
  const sourceDateEpoch = Number(
    git(repository, 'show', '-s', '--format=%ct', commit),
  )
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1) {
    throw new ReleaseError('release commit timestamp is invalid')
  }
  let predecessorTag = ''
  let predecessorCommit = ''
  if (history.length > policy.first_release_distance) {
    const predecessorPatch =
      Number(basePatch) + history.length - policy.first_release_distance - 1
    predecessorTag = `v${major}.${minor}.${predecessorPatch}`
    predecessorCommit = historyFields.at(-2)[0]
  }
  return {
    version,
    tag: `v${version}`,
    firstParentDistance: history.length,
    sourceDateEpoch,
    predecessorTag,
    predecessorCommit,
  }
}

async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = await mkdtemp(
    path.join(path.dirname(file), `.${path.basename(file)}.`),
  )
  const staged = path.join(temporary, 'value')
  try {
    const handle = await open(staged, 'wx', 0o600)
    try {
      await handle.writeFile(value, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(staged, file)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function stageVersion(repository, output, version) {
  if (!versionPattern.test(version)) {
    throw new ReleaseError('staged release version is invalid')
  }
  const relativeOutput = path.relative(repository, output)
  if (
    relativeOutput === '' ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new ReleaseError('staged release directory must be below repository')
  }
  try {
    await lstat(output)
    throw new ReleaseError('staged release directory already exists')
  } catch (error) {
    if (error instanceof ReleaseError || error?.code !== 'ENOENT') {
      throw error
    }
  }
  await mkdir(output, { recursive: false, mode: 0o700 })
  const tracked = git(repository, 'ls-files', '-z').split('\0').filter(Boolean)
  for (const relative of tracked) {
    if (
      path.isAbsolute(relative) ||
      relative.split('/').some((part) => part === '..')
    ) {
      throw new ReleaseError('git returned an unsafe tracked path')
    }
    const source = path.join(repository, ...relative.split('/'))
    const target = path.join(output, ...relative.split('/'))
    const info = await lstat(source)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new ReleaseError(`tracked release input is unsafe: ${relative}`)
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
    await chmod(target, info.mode & 0o777)
  }
  const packageFile = path.join(output, 'package.json')
  const packageLockFile = path.join(output, 'package-lock.json')
  const versionFile = path.join(output, 'src', 'version.ts')
  const packageJSON = JSON.parse(await readFile(packageFile, 'utf8'))
  const packageLock = JSON.parse(await readFile(packageLockFile, 'utf8'))
  if (
    packageJSON.name !== 'lockersm' ||
    packageLock.name !== 'lockersm' ||
    packageLock.packages?.['']?.name !== 'lockersm'
  ) {
    throw new ReleaseError('staged package identity is invalid')
  }
  packageJSON.version = version
  packageLock.version = version
  packageLock.packages[''].version = version
  await writeFile(packageFile, `${JSON.stringify(packageJSON, null, 2)}\n`)
  await writeFile(packageLockFile, `${JSON.stringify(packageLock, null, 2)}\n`)
  const versionSource = await readFile(versionFile, 'utf8')
  const matches = versionSource.match(/export const SDK_VERSION = '[^']+'/gu)
  if (matches?.length !== 1) {
    throw new ReleaseError(
      'SDK version source does not have one canonical field',
    )
  }
  await writeFile(
    versionFile,
    versionSource.replace(
      /export const SDK_VERSION = '[^']+'/u,
      `export const SDK_VERSION = '${version}'`,
    ),
  )
}

function parseRemoteTag(output, tag) {
  const references = new Map()
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const [commit, reference, extra] = line.trim().split(/\s+/u)
    if (extra || !commitPattern.test(commit) || !reference) {
      throw new ReleaseError('remote returned malformed tag data')
    }
    if (references.has(reference) && references.get(reference) !== commit) {
      throw new ReleaseError('remote returned conflicting tag data')
    }
    references.set(reference, commit)
  }
  return (
    references.get(`refs/tags/${tag}^{}`) ?? references.get(`refs/tags/${tag}`)
  )
}

function remoteTagCommit(repository, tag) {
  if (!tagPattern.test(tag)) {
    throw new ReleaseError('remote tag is invalid')
  }
  const result = spawnSync(
    'git',
    [
      '-C',
      repository,
      'ls-remote',
      '--tags',
      'origin',
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) {
    throw new ReleaseError('cannot query remote release tag')
  }
  return parseRemoteTag(result.stdout, tag)
}

function verifyRemoteTag(repository, tag, commit) {
  if (!tagPattern.test(tag) || !commitPattern.test(commit)) {
    throw new ReleaseError('remote tag verification input is invalid')
  }
  const existing = remoteTagCommit(repository, tag)
  if (existing && existing !== commit) {
    throw new ReleaseError(`remote tag ${tag} points to another commit`)
  }
}

export async function waitForPredecessor(
  repository,
  tag,
  commit,
  attempts = 80,
  delayMilliseconds = 15_000,
) {
  if (tag === '' && commit === '') return
  if (
    !tagPattern.test(tag) ||
    !commitPattern.test(commit) ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 120 ||
    !Number.isSafeInteger(delayMilliseconds) ||
    delayMilliseconds < 0 ||
    delayMilliseconds > 60_000
  ) {
    throw new ReleaseError('predecessor gate input is invalid')
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const existing = remoteTagCommit(repository, tag)
    if (existing) {
      if (existing !== commit) {
        throw new ReleaseError(
          `predecessor tag ${tag} points to another commit`,
        )
      }
      process.stdout.write(`verified predecessor ${tag} at ${commit}\n`)
      return
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds))
    }
  }
  throw new ReleaseError(`predecessor tag ${tag} is not available`)
}

async function readBoundedResponse(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    throw new ReleaseError('registry response exceeds size limit')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxResponseBytes) {
      await reader.cancel()
      throw new ReleaseError('registry response exceeds size limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function parseTrustedGitLabURL(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new ReleaseError(`${label} is invalid`)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch (cause) {
    throw new ReleaseError(`${label} is invalid`, { cause })
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new ReleaseError(
      `${label} must be absolute HTTPS without credentials, query, or fragment`,
    )
  }
  return parsed
}

function effectiveHTTPSPort(value) {
  return value.port === '' ? '443' : value.port
}

export function gitLabReleaseCoordinates(apiValue, projectValue, projectID) {
  if (!projectIDPattern.test(projectID)) {
    throw new ReleaseError('GitLab project ID is invalid')
  }
  const api = parseTrustedGitLabURL(apiValue, 'GitLab API URL')
  const project = parseTrustedGitLabURL(projectValue, 'GitLab project URL')
  if (
    api.hostname !== project.hostname ||
    effectiveHTTPSPort(api) !== effectiveHTTPSPort(project)
  ) {
    throw new ReleaseError(
      'GitLab API and project URLs must have the same HTTPS origin',
    )
  }
  const endpoint = new URL(api.href)
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, '')}/projects/${projectID}/releases`
  return {
    endpoint: endpoint.href,
    origin: endpoint.origin,
    projectBase: project.href.replace(/\/+$/u, ''),
  }
}

async function fetchNpmRelease(version) {
  const response = await fetch(
    `${npmReleaseEndpoint}${encodeURIComponent(version)}`,
    {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'locker-js-sdk-release/1' },
    },
  )
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new ReleaseError(
      `npm registry reconciliation failed with HTTP ${response.status}`,
    )
  }
  let value
  try {
    value = JSON.parse((await readBoundedResponse(response)).toString('utf8'))
  } catch (cause) {
    if (cause instanceof ReleaseError) throw cause
    throw new ReleaseError('npm registry returned invalid JSON', { cause })
  }
  if (
    value?.name !== 'lockersm' ||
    value?.version !== version ||
    typeof value?.dist?.integrity !== 'string'
  ) {
    throw new ReleaseError('npm registry returned invalid release metadata')
  }
  return value
}

async function publishNpm(artifact, version) {
  const info = await lstat(artifact)
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1) {
    throw new ReleaseError('npm release artifact is unavailable')
  }
  const expectedIntegrity = `sha512-${createHash('sha512')
    .update(await readFile(artifact))
    .digest('base64')}`
  const reconcile = async () => {
    const release = await fetchNpmRelease(version)
    if (!release) return false
    if (release.dist.integrity !== expectedIntegrity) {
      throw new ReleaseError(
        'npm already contains different bytes for this version',
      )
    }
    return true
  }
  if (await reconcile()) {
    process.stdout.write(`npm already contains exact lockersm ${version}\n`)
    return
  }
  if (!process.env.NPM_TOKEN) {
    throw new ReleaseError('missing protected CI variable: NPM_TOKEN')
  }
  const published = spawnSync(
    'npm',
    ['publish', artifact, '--access', 'public', '--ignore-scripts'],
    {
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    },
  )
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await reconcile()) {
      process.stdout.write(`published and verified lockersm ${version}\n`)
      return
    }
    if (attempt < 19) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
  }
  throw new ReleaseError(
    published.status === 0
      ? 'npm did not expose the published release'
      : 'npm publish failed and no exact release could be reconciled',
  )
}

async function gitLabRequest(method, endpoint, body, trustedOrigin) {
  const requestURL = parseTrustedGitLabURL(endpoint, 'GitLab release endpoint')
  if (requestURL.origin !== trustedOrigin) {
    throw new ReleaseError('refuse cross-origin GitLab release request')
  }
  const response = await fetch(requestURL, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'job-token': process.env.CI_JOB_TOKEN ?? '',
      'user-agent': 'locker-js-sdk-release/1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    status: response.status,
    body: await readBoundedResponse(response),
  }
}

async function createGitLabRelease(options) {
  const { version, tag, commit, releasedAt, title } = options
  if (
    !versionPattern.test(version) ||
    tag !== `v${version}` ||
    !commitPattern.test(commit) ||
    !Number.isFinite(Date.parse(releasedAt)) ||
    !title ||
    title.trim() !== title ||
    /[\r\n]/u.test(title)
  ) {
    throw new ReleaseError('GitLab release identity is invalid')
  }
  const required = [
    'CI_API_V4_URL',
    'CI_PROJECT_ID',
    'CI_PROJECT_URL',
    'CI_JOB_TOKEN',
  ]
  if (required.some((name) => !process.env[name])) {
    throw new ReleaseError('GitLab release environment is incomplete')
  }
  const coordinates = gitLabReleaseCoordinates(
    process.env.CI_API_V4_URL,
    process.env.CI_PROJECT_URL,
    process.env.CI_PROJECT_ID,
  )
  const { endpoint } = coordinates
  const payload = {
    name: `Locker Secrets Node.js SDK ${tag}`,
    tag_name: tag,
    ref: commit,
    tag_message: `Locker Secrets Node.js SDK ${tag}`,
    released_at: releasedAt,
    description:
      `### Changes\n\n${title}\n\n` +
      `- [npm](https://www.npmjs.com/package/lockersm/v/${version})\n` +
      `- [Source](${coordinates.projectBase}/-/tree/${tag})\n`,
  }
  let result = await gitLabRequest(
    'POST',
    endpoint,
    payload,
    coordinates.origin,
  )
  if (result.status === 400 || result.status === 409) {
    result = await gitLabRequest(
      'GET',
      `${endpoint}/${encodeURIComponent(tag)}`,
      undefined,
      coordinates.origin,
    )
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ReleaseError(
      `GitLab release request failed with HTTP ${result.status}`,
    )
  }
  let release
  try {
    release = JSON.parse(result.body.toString('utf8'))
  } catch (cause) {
    throw new ReleaseError('GitLab returned invalid release JSON', { cause })
  }
  if (release?.tag_name !== tag || release?.commit?.id !== commit) {
    throw new ReleaseError('GitLab release points to another commit')
  }
}

function parseArguments(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]
    const value = values[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      throw new ReleaseError('release command arguments are invalid')
    }
    const key = name.slice(2)
    if (Object.hasOwn(result, key)) {
      throw new ReleaseError('release command arguments contain duplicates')
    }
    result[key] = value
  }
  return result
}

async function command(values) {
  const [name, ...arguments_] = values
  const options = parseArguments(arguments_)
  if (name === 'prepare') {
    const release = await prepareRelease(
      path.resolve(options.repository ?? root),
      options.commit ?? '',
    )
    const output = path.resolve(options.output ?? 'release.env')
    await writeAtomic(
      output,
      `LOCKER_SDK_VERSION=${release.version}\n` +
        `LOCKER_RELEASE_TAG=${release.tag}\n` +
        `SOURCE_DATE_EPOCH=${release.sourceDateEpoch}\n` +
        `LOCKER_PREDECESSOR_TAG=${release.predecessorTag}\n` +
        `LOCKER_PREDECESSOR_COMMIT=${release.predecessorCommit}\n`,
    )
    process.stdout.write(
      `prepared lockersm ${release.version} (${release.tag}, ` +
        `first-parent distance ${release.firstParentDistance})\n`,
    )
    return
  }
  if (name === 'stage-version') {
    await stageVersion(
      path.resolve(options.repository ?? root),
      path.resolve(options.output ?? ''),
      options.version ?? '',
    )
    return
  }
  if (name === 'wait-predecessor') {
    await waitForPredecessor(
      path.resolve(options.repository ?? root),
      options.tag ?? '',
      options.commit ?? '',
    )
    return
  }
  if (name === 'verify-tag') {
    verifyRemoteTag(
      path.resolve(options.repository ?? root),
      options.tag ?? '',
      options.commit ?? '',
    )
    return
  }
  if (name === 'publish-npm') {
    await publishNpm(
      path.resolve(options.artifact ?? ''),
      options.version ?? '',
    )
    return
  }
  if (name === 'create-release') {
    await createGitLabRelease({
      version: options.version ?? '',
      tag: options.tag ?? '',
      commit: options.commit ?? '',
      releasedAt: options['released-at'] ?? '',
      title: options.title ?? '',
    })
    return
  }
  throw new ReleaseError(`unknown release command ${JSON.stringify(name)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  command(process.argv.slice(2)).catch((error) => {
    const message =
      error instanceof ReleaseError
        ? error.message
        : 'unexpected release command failure'
    process.stderr.write(`release error: ${message}\n`)
    process.exitCode = 1
  })
}
