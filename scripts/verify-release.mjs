import { promises as fs } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/
const MAX_JSON_BYTES = 1024 * 1024
const MAX_LICENSE_BYTES = 64 * 1024
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
const RELEASE_TRUST_FIELDS = new Set([
  'base_url',
  'check_interval_seconds',
  'key_id',
  'public_key',
  'schema_version',
])
const RELEASE_BASE_URL = 'https://files.locker.io/cli/releases/'
const RELEASE_KEY_ID = 'locker-cli-release-v1'
const RELEASE_CHECK_INTERVAL_SECONDS = 21_600
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const LICENSE_MARKERS = Object.freeze({
  'Apache-2.0': ['Apache License', 'Version 2.0'],
  'BSD-2-Clause': ['BSD 2-Clause'],
  'BSD-3-Clause': ['BSD 3-Clause'],
  ISC: ['ISC License'],
  MIT: ['MIT License'],
  'MPL-2.0': ['Mozilla Public License', '2.0'],
})

export class VerificationError extends Error {}

function parseStrictJSON(input, maxDepth = 128) {
  let offset = 0
  const fail = (message) => {
    throw new VerificationError(message)
  }
  const skipWhitespace = () => {
    while (
      offset < input.length &&
      (input[offset] === ' ' ||
        input[offset] === '\t' ||
        input[offset] === '\r' ||
        input[offset] === '\n')
    ) {
      offset += 1
    }
  }
  const parseString = () => {
    if (input[offset] !== '"') {
      fail('JSON object keys must be strings')
    }
    const start = offset
    offset += 1
    while (offset < input.length) {
      const character = input.charCodeAt(offset)
      if (character === 0x22) {
        offset += 1
        return JSON.parse(input.slice(start, offset))
      }
      if (character < 0x20) {
        fail('JSON string contains a control character')
      }
      if (character === 0x5c) {
        offset += 1
        const escape = input[offset]
        if (escape === undefined || !'"\\/bfnrtu'.includes(escape)) {
          fail('JSON string contains an invalid escape')
        }
        if (escape === 'u') {
          if (!/^[0-9A-Fa-f]{4}$/.test(input.slice(offset + 1, offset + 5))) {
            fail('JSON string contains an invalid escape')
          }
          offset += 4
        }
      }
      offset += 1
    }
    fail('JSON string is unterminated')
  }
  const parseValue = (depth) => {
    if (depth > maxDepth) {
      fail(`JSON nesting exceeds ${maxDepth} levels`)
    }
    skipWhitespace()
    const character = input[offset]
    if (character === '{') {
      offset += 1
      skipWhitespace()
      const fields = new Set()
      if (input[offset] === '}') {
        offset += 1
        return
      }
      while (true) {
        const field = parseString()
        if (fields.has(field)) {
          fail(`JSON object contains duplicate field ${JSON.stringify(field)}`)
        }
        fields.add(field)
        skipWhitespace()
        if (input[offset] !== ':') {
          fail('JSON object field is missing a colon')
        }
        offset += 1
        parseValue(depth + 1)
        skipWhitespace()
        if (input[offset] === '}') {
          offset += 1
          return
        }
        if (input[offset] !== ',') {
          fail('JSON object is missing a comma')
        }
        offset += 1
        skipWhitespace()
      }
    }
    if (character === '[') {
      offset += 1
      skipWhitespace()
      if (input[offset] === ']') {
        offset += 1
        return
      }
      while (true) {
        parseValue(depth + 1)
        skipWhitespace()
        if (input[offset] === ']') {
          offset += 1
          return
        }
        if (input[offset] !== ',') {
          fail('JSON array is missing a comma')
        }
        offset += 1
      }
    }
    if (character === '"') {
      parseString()
      return
    }
    for (const literal of ['true', 'false', 'null']) {
      if (input.startsWith(literal, offset)) {
        offset += literal.length
        return
      }
    }
    const number = input
      .slice(offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)
    if (!number) {
      fail('JSON contains an invalid value')
    }
    offset += number[0].length
  }

  skipWhitespace()
  parseValue(0)
  skipWhitespace()
  if (offset !== input.length) {
    fail('JSON must contain exactly one value')
  }
  return JSON.parse(input)
}

async function readRegularBytes(filePath, maximum, label) {
  let info
  try {
    info = await fs.lstat(filePath)
  } catch (cause) {
    throw new VerificationError(`${label} is unavailable: ${filePath}`, {
      cause,
    })
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new VerificationError(
      `${label} must be a regular non-symlink file: ${filePath}`,
    )
  }
  if (info.size < 1 || info.size > maximum) {
    throw new VerificationError(`${label} has an invalid size: ${filePath}`)
  }
  return await fs.readFile(filePath)
}

async function readJSON(filePath, expectedFields, label) {
  const bytes = await readRegularBytes(filePath, MAX_JSON_BYTES, label)
  let value
  try {
    value = parseStrictJSON(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    )
  } catch (cause) {
    if (cause instanceof VerificationError) {
      throw cause
    }
    throw new VerificationError(`${label} is not strict UTF-8 JSON`, {
      cause,
    })
  }
  requireRecord(value, label)
  requireExactFields(value, expectedFields, label)
  return value
}

function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VerificationError(`${label} must be an object`)
  }
}

function requireExactFields(value, fields, label) {
  const actual = Object.keys(value)
  if (
    actual.length !== fields.size ||
    actual.some((field) => !fields.has(field))
  ) {
    throw new VerificationError(`${label} fields do not match the contract`)
  }
}

function requireString(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new VerificationError(`${label} must be a nonempty trimmed string`)
  }
  return value
}

function validateReleaseTrust(configuration, expectedPublicKey) {
  if (
    configuration.schema_version !== 2 ||
    configuration.base_url !== RELEASE_BASE_URL ||
    configuration.key_id !== RELEASE_KEY_ID ||
    configuration.check_interval_seconds !== RELEASE_CHECK_INTERVAL_SECONDS ||
    typeof configuration.public_key !== 'string' ||
    configuration.public_key.length === 0 ||
    !BASE64URL_PATTERN.test(configuration.public_key) ||
    configuration.public_key.includes('=')
  ) {
    throw new VerificationError(
      'Locker CLI release trust resource is invalid or unprovisioned',
    )
  }
  const decoded = Buffer.from(configuration.public_key, 'base64url')
  if (
    decoded.length !== 32 ||
    decoded.toString('base64url') !== configuration.public_key
  ) {
    decoded.fill(0)
    throw new VerificationError(
      'Locker CLI release public key is not canonical raw Ed25519',
    )
  }
  decoded.fill(0)
  if (typeof expectedPublicKey !== 'string') {
    throw new VerificationError(
      'packaged Locker CLI trust root does not match the independent protected key',
    )
  }
  const packagedKey = Buffer.from(configuration.public_key, 'ascii')
  const protectedKey = Buffer.from(expectedPublicKey, 'ascii')
  const matches =
    packagedKey.length === protectedKey.length &&
    timingSafeEqual(packagedKey, protectedKey)
  packagedKey.fill(0)
  protectedKey.fill(0)
  if (!matches) {
    throw new VerificationError(
      'packaged Locker CLI trust root does not match the independent protected key',
    )
  }
}

async function validateLicense(root, packageJSON, packageLock) {
  const licenseName = requireString(packageJSON.license, 'package license')
  requireRecord(packageLock.packages, 'package-lock.json packages')
  const rootLock = packageLock.packages['']
  requireRecord(rootLock, 'package-lock.json root package')
  if (
    packageLock.name !== packageJSON.name ||
    packageLock.version !== packageJSON.version ||
    rootLock.name !== packageJSON.name ||
    rootLock.version !== packageJSON.version ||
    rootLock.license !== licenseName
  ) {
    throw new VerificationError(
      'package.json and package-lock.json identity/license are inconsistent',
    )
  }

  const licenseBytes = await readRegularBytes(
    path.join(root, 'LICENSE'),
    MAX_LICENSE_BYTES,
    'LICENSE',
  )
  let licenseText
  try {
    licenseText = new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes)
  } catch (cause) {
    throw new VerificationError('LICENSE must be UTF-8 text', { cause })
  }
  if (!licenseText.trim()) {
    throw new VerificationError('LICENSE must not be empty')
  }
  const markers = LICENSE_MARKERS[licenseName] ?? [licenseName]
  if (
    markers.some(
      (marker) =>
        !licenseText
          .toLocaleLowerCase('en-US')
          .includes(marker.toLocaleLowerCase('en-US')),
    )
  ) {
    throw new VerificationError(
      'LICENSE content is inconsistent with package metadata',
    )
  }
  return licenseBytes
}

function parseTarOctal(bytes, label) {
  const value = bytes.toString('ascii').replace(/\0.*$/u, '').trim()
  if (!/^[0-7]+$/u.test(value)) {
    throw new VerificationError(`npm package contains invalid tar ${label}`)
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new VerificationError(`npm package contains invalid tar ${label}`)
  }
  return parsed
}

function validateTarChecksum(header) {
  const expected = parseTarOctal(header.subarray(148, 156), 'checksum')
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) {
    throw new VerificationError('npm package tar checksum mismatch')
  }
}

function tarString(bytes) {
  const zero = bytes.indexOf(0)
  return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString('utf8')
}

function parseTar(bytes) {
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) {
      return entries
    }
    validateTarChecksum(header)
    const prefix = tarString(header.subarray(345, 500))
    const name = tarString(header.subarray(0, 100))
    const fullName = prefix ? `${prefix}/${name}` : name
    if (
      !fullName.startsWith('package/') ||
      fullName.split('/').some((part) => part === '..')
    ) {
      throw new VerificationError(
        `npm package contains unsafe path ${JSON.stringify(fullName)}`,
      )
    }
    if (entries.has(fullName)) {
      throw new VerificationError(
        `npm package contains duplicate path ${JSON.stringify(fullName)}`,
      )
    }
    const size = parseTarOctal(header.subarray(124, 136), 'size')
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > bytes.length) {
      throw new VerificationError('npm package tar entry is truncated')
    }
    const type = header[156]
    if (type === 0 || type === 0x30) {
      entries.set(fullName, bytes.subarray(dataStart, dataEnd))
    } else {
      entries.set(fullName, undefined)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new VerificationError('npm package tar terminator is missing')
}

function canonicalJSON(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJSON)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJSON(value[key])]),
    )
  }
  return value
}

export async function verifyArtifact(
  artifactPath,
  packageJSON,
  releaseTrust,
  licenseBytes,
) {
  const expectedName = `lockersm-${packageJSON.version}.tgz`
  if (path.basename(artifactPath) !== expectedName) {
    throw new VerificationError(
      `npm package filename must be ${JSON.stringify(expectedName)}`,
    )
  }
  const compressed = await readRegularBytes(
    artifactPath,
    MAX_ARTIFACT_BYTES,
    'npm package',
  )
  let archive
  try {
    archive = gunzipSync(compressed, { maxOutputLength: MAX_ARTIFACT_BYTES })
  } catch (cause) {
    throw new VerificationError('npm package is not a bounded gzip archive', {
      cause,
    })
  }
  const entries = parseTar(archive)
  const packagedJSON = entries.get('package/package.json')
  const packagedTrust = entries.get('package/locker-cli-release.json')
  const packagedLicense = entries.get('package/LICENSE')
  if (!packagedJSON || !packagedTrust || !packagedLicense) {
    throw new VerificationError(
      'npm package is missing package.json, CLI trust root, or LICENSE',
    )
  }
  const parsedPackage = parseStrictJSON(
    new TextDecoder('utf-8', { fatal: true }).decode(packagedJSON),
  )
  const parsedTrust = parseStrictJSON(
    new TextDecoder('utf-8', { fatal: true }).decode(packagedTrust),
  )
  if (
    JSON.stringify(canonicalJSON(parsedPackage)) !==
      JSON.stringify(canonicalJSON(packageJSON)) ||
    JSON.stringify(canonicalJSON(parsedTrust)) !==
      JSON.stringify(canonicalJSON(releaseTrust)) ||
    !packagedLicense.equals(licenseBytes)
  ) {
    throw new VerificationError('npm package metadata differs from source')
  }
}

export async function verifyRelease({ root, tag, releasePublicKey, artifact }) {
  const resolvedRoot = path.resolve(root)
  if (!SEMVER_PATTERN.test(tag)) {
    throw new VerificationError('release tag is not strict SemVer')
  }
  const packageJSON = await readJSON(
    path.join(resolvedRoot, 'package.json'),
    new Set([
      'author',
      'bin',
      'bugs',
      'description',
      'devDependencies',
      'engines',
      'exports',
      'files',
      'homepage',
      'license',
      'main',
      'module',
      'name',
      'repository',
      'scripts',
      'types',
      'version',
    ]),
    'package.json',
  )
  if (packageJSON.name !== 'lockersm') {
    throw new VerificationError('package name must be lockersm')
  }
  const version = requireString(packageJSON.version, 'package version')
  if (version !== tag) {
    throw new VerificationError(
      'release tag must exactly equal the package version',
    )
  }
  const packageLock = await readJSON(
    path.join(resolvedRoot, 'package-lock.json'),
    new Set([
      'dependencies',
      'lockfileVersion',
      'name',
      'packages',
      'requires',
      'version',
    ]),
    'package-lock.json',
  )
  const licenseBytes = await validateLicense(
    resolvedRoot,
    packageJSON,
    packageLock,
  )

  const releaseTrust = await readJSON(
    path.join(resolvedRoot, 'locker-cli-release.json'),
    RELEASE_TRUST_FIELDS,
    'locker-cli-release.json',
  )
  validateReleaseTrust(releaseTrust, releasePublicKey)
  if (artifact) {
    await verifyArtifact(
      path.resolve(artifact),
      packageJSON,
      releaseTrust,
      licenseBytes,
    )
  }
}

function parseArguments(arguments_) {
  const options = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]
    const value = arguments_[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      throw new VerificationError('release verifier arguments are invalid')
    }
    options[name.slice(2)] = value
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const root = options.root ?? fileURLToPath(new URL('../', import.meta.url))
  if (!options.tag) {
    throw new VerificationError('--tag is required')
  }
  await verifyRelease({
    root,
    tag: options.tag,
    releasePublicKey: process.env.LOCKER_CLI_RELEASE_PUBLIC_KEY,
    artifact: options.artifact,
  })
  process.stdout.write(
    `release verification passed for lockersm ${options.tag}\n`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message =
      error instanceof VerificationError
        ? error.message
        : 'unexpected release verifier failure'
    process.stderr.write(`release verification failed: ${message}\n`)
    process.exitCode = 1
  })
}
