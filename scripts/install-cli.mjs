import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const BASE_URL = 'https://files.locker.io/cli/releases/'
export const KEY_ID = 'locker-cli-release-v1'
export const CHECK_INTERVAL_SECONDS = 21_600
export const UPDATE_RETRY_SECONDS = 60
export const MAX_LATEST_BYTES = 64 * 1024
export const MAX_MANIFEST_BYTES = 1024 * 1024
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024

const SIGNATURE_BYTES = 64
const JSON_DEPTH = 64
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_LOCK_TIMEOUT_MS = 30_000
const LOCK_STALE_MS = 15 * 60_000
const ENVELOPE_SCHEMA = 'io.locker.cli.signed-envelope'
const LATEST_SCHEMA = 'io.locker.cli.update-latest'
const MANIFEST_SCHEMA = 'io.locker.cli.update-manifest'
const PRODUCT = 'locker-cli'
const ALGORITHM = 'Ed25519'
const PROTOCOL_NAME = 'locker.sdk'
const PROTOCOL_TRANSPORT = 'json-rpc-2.0-stdio'
const PROTOCOL_VERSION = 1
const SCHEMA_VERSION = 2
const LOCAL_CURRENT_SCHEMA = 'io.locker.sdk.cli-install'
const LOCAL_CHECK_SCHEMA = 'io.locker.sdk.cli-update-check'
const LOCAL_ACCEPTED_SCHEMA = 'io.locker.sdk.cli-accepted-release'

const VERSION_PATTERN = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const INTEGER_PATTERN = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/

const TARGETS = Object.freeze([
  Object.freeze({
    os: 'linux',
    arch: 'amd64',
    filename: 'locker-linux-amd64',
  }),
  Object.freeze({
    os: 'linux',
    arch: 'arm64',
    filename: 'locker-linux-arm64',
  }),
  Object.freeze({
    os: 'darwin',
    arch: 'amd64',
    filename: 'locker-darwin-amd64',
  }),
  Object.freeze({
    os: 'darwin',
    arch: 'arm64',
    filename: 'locker-darwin-arm64',
  }),
  Object.freeze({
    os: 'windows',
    arch: 'amd64',
    filename: 'locker-windows-amd64.exe',
  }),
])

const ENVELOPE_FIELDS = new Set([
  'algorithm',
  'key_id',
  'payload',
  'schema',
  'schema_version',
  'signature',
])
const LATEST_FIELDS = new Set([
  'manifest',
  'product',
  'schema',
  'schema_version',
  'source_commit',
  'version',
])
const POINTER_FIELDS = new Set(['path', 'sha256', 'size'])
const MANIFEST_FIELDS = new Set([
  'artifacts',
  'product',
  'protocol',
  'schema',
  'schema_version',
  'source_commit',
  'version',
])
const PROTOCOL_FIELDS = new Set([
  'max_version',
  'min_version',
  'name',
  'transport',
])
const ARTIFACT_FIELDS = new Set([
  'arch',
  'filename',
  'os',
  'path',
  'sha256',
  'signature_path',
  'size',
])
const TRUST_FIELDS = new Set([
  'base_url',
  'check_interval_seconds',
  'key_id',
  'public_key',
  'schema_version',
])
const CURRENT_FIELDS = new Set([
  'artifact_filename',
  'artifact_sha256',
  'artifact_size',
  'manifest_sha256',
  'manifest_size',
  'schema',
  'schema_version',
  'source_commit',
  'version',
])
const CHECK_FIELDS = new Set([
  'checked_at_unix',
  'manifest_sha256',
  'retry_after_unix',
  'schema',
  'schema_version',
  'source_commit',
  'version',
])
const ACCEPTED_FIELDS = new Set([
  'manifest_sha256',
  'manifest_size',
  'schema',
  'schema_version',
  'source_commit',
  'version',
])

export class ManagedInstallUnavailable extends Error {}
export class UpdateNetworkError extends Error {}

const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])

export function classifyRequestError(cause) {
  if (cause instanceof UpdateNetworkError) {
    return cause
  }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    typeof cause.code === 'string' &&
    TRANSIENT_NETWORK_CODES.has(cause.code)
  ) {
    return new UpdateNetworkError('Locker CLI download failed', { cause })
  }
  return new Error('Locker CLI download TLS or transport validation failed', {
    cause,
  })
}

export function responseStatusError(status) {
  if (
    Number.isInteger(status) &&
    (status === 408 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status <= 599))
  ) {
    return new UpdateNetworkError(
      `Locker CLI download returned transient HTTP ${status}`,
    )
  }
  return new Error(`Locker CLI download returned HTTP ${status ?? 0}`)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactRecord(value, fields, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }
  const keys = Object.keys(value)
  if (keys.length !== fields.size || keys.some((field) => !fields.has(field))) {
    throw new Error(`${label} has invalid fields`)
  }
  return value
}

function validateJSONValue(value, depth = 0) {
  if (depth > JSON_DEPTH) {
    throw new SyntaxError(`JSON nesting exceeds ${JSON_DEPTH} levels`)
  }
  if (value === null || typeof value === 'boolean') {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new SyntaxError('JSON numbers must be safe signed integers')
    }
    return
  }
  if (typeof value === 'string') {
    if (!/^[\x00-\x7f]*$/.test(value)) {
      throw new SyntaxError('JSON strings must be ASCII')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJSONValue(item, depth + 1)
    }
    return
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!/^[\x00-\x7f]*$/.test(key)) {
        throw new SyntaxError('JSON object keys must be ASCII')
      }
      validateJSONValue(item, depth + 1)
    }
    return
  }
  throw new SyntaxError('JSON contains an unsupported value')
}

export function parseStrictJSON(input, maxDepth = JSON_DEPTH) {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.charCodeAt(0) === 0xfeff ||
    maxDepth !== JSON_DEPTH
  ) {
    throw new SyntaxError('JSON input is invalid')
  }
  let offset = 0
  const fail = (message) => {
    throw new SyntaxError(message)
  }
  const skipWhitespace = () => {
    while (
      offset < input.length &&
      [' ', '\t', '\r', '\n'].includes(input[offset])
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
            fail('JSON string contains an invalid Unicode escape')
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
    const number = input.slice(offset).match(/^-?(?:0|[1-9][0-9]*)/)
    if (!number || !INTEGER_PATTERN.test(number[0])) {
      fail('JSON numbers must be canonical integers')
    }
    const next = input[offset + number[0].length]
    if (next === '.' || next === 'e' || next === 'E') {
      fail('JSON floating-point numbers are forbidden')
    }
    const parsed = Number(number[0])
    if (!Number.isSafeInteger(parsed)) {
      fail('JSON integer is outside the JavaScript safe range')
    }
    offset += number[0].length
  }
  skipWhitespace()
  parseValue(1)
  skipWhitespace()
  if (offset !== input.length) {
    fail('JSON must contain exactly one value')
  }
  const value = JSON.parse(input)
  validateJSONValue(value)
  return value
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    )
  }
  return value
}

export function canonicalJSON(value) {
  validateJSONValue(value)
  const serialized = JSON.stringify(canonicalValue(value)).replace(
    /\x7f/g,
    '\\u007f',
  )
  return Buffer.from(serialized, 'ascii')
}

function safeEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right)
}

function decodeBase64URL(value, expectedBytes, label) {
  if (
    typeof value !== 'string' ||
    !BASE64URL_PATTERN.test(value) ||
    value.includes('=')
  ) {
    throw new Error(`${label} is not canonical base64url`)
  }
  const decoded = Buffer.from(value, 'base64url')
  if (
    decoded.length !== expectedBytes ||
    decoded.toString('base64url') !== value
  ) {
    decoded.fill(0)
    throw new Error(`${label} is not canonical base64url`)
  }
  return decoded
}

function ed25519PublicKey(rawKey) {
  if (!Buffer.isBuffer(rawKey) || rawKey.length !== 32) {
    throw new Error('Locker CLI release public key must contain 32 raw bytes')
  }
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  return createPublicKey({
    key: Buffer.concat([prefix, rawKey]),
    format: 'der',
    type: 'spki',
  })
}

function verifyEd25519(content, signature, trust) {
  if (
    !Buffer.isBuffer(signature) ||
    signature.length !== SIGNATURE_BYTES ||
    !verifySignature(
      null,
      content,
      ed25519PublicKey(trust.publicKey),
      signature,
    )
  ) {
    throw new Error('Locker CLI Ed25519 signature verification failed')
  }
}

function decodeUTF8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new Error(`${label} is not valid UTF-8`, { cause })
  }
}

function validateTrust(value) {
  if (
    !isRecord(value) ||
    value.baseUrl !== BASE_URL ||
    value.keyId !== KEY_ID ||
    value.checkIntervalSeconds !== CHECK_INTERVAL_SECONDS ||
    !Buffer.isBuffer(value.publicKey) ||
    value.publicKey.length !== 32
  ) {
    throw new ManagedInstallUnavailable(
      'Locker CLI managed installation trust root is invalid',
    )
  }
  return Object.freeze({
    baseUrl: BASE_URL,
    keyId: KEY_ID,
    publicKey: Buffer.from(value.publicKey),
    checkIntervalSeconds: CHECK_INTERVAL_SECONDS,
  })
}

export async function loadReleaseTrust(configurationPath) {
  const bytes = await readRegularFile(
    configurationPath,
    16 * 1024,
    undefined,
    'Locker CLI release trust resource',
  )
  let config
  try {
    config = exactRecord(
      parseStrictJSON(decodeUTF8(bytes, 'Locker CLI release trust resource')),
      TRUST_FIELDS,
      'Locker CLI release trust resource',
    )
  } finally {
    bytes.fill(0)
  }
  if (
    config.schema_version !== SCHEMA_VERSION ||
    config.base_url !== BASE_URL ||
    config.key_id !== KEY_ID ||
    config.check_interval_seconds !== CHECK_INTERVAL_SECONDS
  ) {
    throw new ManagedInstallUnavailable(
      'Locker CLI release trust resource is invalid',
    )
  }
  if (config.public_key === '') {
    throw new ManagedInstallUnavailable(
      'Locker CLI managed installation has no production trust root',
    )
  }
  return validateTrust({
    baseUrl: config.base_url,
    keyId: config.key_id,
    publicKey: decodeBase64URL(
      config.public_key,
      32,
      'Locker CLI release public key',
    ),
    checkIntervalSeconds: config.check_interval_seconds,
  })
}

export function verifyEnvelope(bytes, trust, payloadSchema, maximum) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximum) {
    throw new Error('Locker CLI signed envelope has an invalid size')
  }
  const envelope = exactRecord(
    parseStrictJSON(decodeUTF8(bytes, 'Locker CLI signed envelope')),
    ENVELOPE_FIELDS,
    'Locker CLI signed envelope',
  )
  if (
    !safeEqual(
      Buffer.concat([canonicalJSON(envelope), Buffer.from('\n')]),
      bytes,
    )
  ) {
    throw new Error(
      'Locker CLI signed envelope is not canonical JSON plus one LF',
    )
  }
  if (
    envelope.algorithm !== ALGORITHM ||
    envelope.key_id !== trust.keyId ||
    envelope.schema !== ENVELOPE_SCHEMA ||
    envelope.schema_version !== SCHEMA_VERSION
  ) {
    throw new Error('Locker CLI signed envelope identity is invalid')
  }
  if (
    typeof envelope.payload !== 'string' ||
    !BASE64URL_PATTERN.test(envelope.payload)
  ) {
    throw new Error('Locker CLI signed payload encoding is invalid')
  }
  const payloadBytes = Buffer.from(envelope.payload, 'base64url')
  if (
    payloadBytes.length < 1 ||
    payloadBytes.length > maximum ||
    payloadBytes.toString('base64url') !== envelope.payload
  ) {
    payloadBytes.fill(0)
    throw new Error('Locker CLI signed payload encoding is non-canonical')
  }
  const payload = exactRecord(
    parseStrictJSON(decodeUTF8(payloadBytes, 'Locker CLI signed payload')),
    payloadSchema === LATEST_SCHEMA ? LATEST_FIELDS : MANIFEST_FIELDS,
    'Locker CLI signed payload',
  )
  if (
    !safeEqual(canonicalJSON(payload), payloadBytes) ||
    payload.schema !== payloadSchema ||
    payload.schema_version !== SCHEMA_VERSION
  ) {
    payloadBytes.fill(0)
    throw new Error('Locker CLI signed payload is not canonical or compatible')
  }
  const signature = decodeBase64URL(
    envelope.signature,
    SIGNATURE_BYTES,
    'Locker CLI envelope signature',
  )
  try {
    verifyEd25519(payloadBytes, signature, trust)
  } finally {
    signature.fill(0)
  }
  return { payload, payloadBytes, envelopeBytes: Buffer.from(bytes) }
}

export function parseLatest(bytes, trust) {
  const { payload } = verifyEnvelope(
    bytes,
    trust,
    LATEST_SCHEMA,
    MAX_LATEST_BYTES,
  )
  if (
    payload.product !== PRODUCT ||
    typeof payload.version !== 'string' ||
    !VERSION_PATTERN.test(payload.version) ||
    typeof payload.source_commit !== 'string' ||
    !COMMIT_PATTERN.test(payload.source_commit)
  ) {
    throw new Error('Locker CLI latest payload provenance is invalid')
  }
  const pointer = exactRecord(
    payload.manifest,
    POINTER_FIELDS,
    'Locker CLI manifest pointer',
  )
  if (
    pointer.path !== `${payload.version}/manifest.json` ||
    typeof pointer.sha256 !== 'string' ||
    !SHA256_PATTERN.test(pointer.sha256) ||
    !Number.isSafeInteger(pointer.size) ||
    pointer.size < 1 ||
    pointer.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error('Locker CLI latest manifest pointer is invalid')
  }
  return {
    version: payload.version,
    sourceCommit: payload.source_commit,
    manifest: {
      path: pointer.path,
      sha256: pointer.sha256,
      size: pointer.size,
    },
  }
}

export function parseManifest(bytes, trust) {
  const { payload } = verifyEnvelope(
    bytes,
    trust,
    MANIFEST_SCHEMA,
    MAX_MANIFEST_BYTES,
  )
  if (
    payload.product !== PRODUCT ||
    typeof payload.version !== 'string' ||
    !VERSION_PATTERN.test(payload.version) ||
    typeof payload.source_commit !== 'string' ||
    !COMMIT_PATTERN.test(payload.source_commit)
  ) {
    throw new Error('Locker CLI manifest provenance is invalid')
  }
  const protocol = exactRecord(
    payload.protocol,
    PROTOCOL_FIELDS,
    'Locker CLI manifest protocol',
  )
  if (
    protocol.min_version !== PROTOCOL_VERSION ||
    protocol.max_version !== PROTOCOL_VERSION ||
    protocol.name !== PROTOCOL_NAME ||
    protocol.transport !== PROTOCOL_TRANSPORT
  ) {
    throw new Error('Locker CLI manifest protocol is incompatible')
  }
  if (
    !Array.isArray(payload.artifacts) ||
    payload.artifacts.length !== TARGETS.length
  ) {
    throw new Error('Locker CLI manifest must contain five artifacts')
  }
  const expected = new Map(TARGETS.map((target) => [target.filename, target]))
  const seen = new Set()
  const artifacts = payload.artifacts.map((raw) => {
    const artifact = exactRecord(
      raw,
      ARTIFACT_FIELDS,
      'Locker CLI manifest artifact',
    )
    const target =
      typeof artifact.filename === 'string'
        ? expected.get(artifact.filename)
        : undefined
    if (!target || seen.has(target.filename)) {
      throw new Error(
        'Locker CLI manifest contains an unknown or duplicate artifact',
      )
    }
    if (
      artifact.os !== target.os ||
      artifact.arch !== target.arch ||
      artifact.path !== `${payload.version}/${target.filename}` ||
      artifact.signature_path !== `${payload.version}/${target.filename}.sig` ||
      typeof artifact.sha256 !== 'string' ||
      !SHA256_PATTERN.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 1 ||
      artifact.size > MAX_ARTIFACT_BYTES
    ) {
      throw new Error('Locker CLI manifest artifact is invalid')
    }
    seen.add(target.filename)
    return Object.freeze({
      os: target.os,
      arch: target.arch,
      filename: target.filename,
      path: artifact.path,
      signaturePath: artifact.signature_path,
      sha256: artifact.sha256,
      size: artifact.size,
    })
  })
  if (seen.size !== TARGETS.length) {
    throw new Error('Locker CLI manifest platform set is incomplete')
  }
  return Object.freeze({
    version: payload.version,
    sourceCommit: payload.source_commit,
    artifacts: Object.freeze(artifacts),
  })
}

export function platformIdentity(
  nodePlatform = process.platform,
  nodeArchitecture = process.arch,
) {
  const osName =
    nodePlatform === 'win32'
      ? 'windows'
      : nodePlatform === 'darwin' || nodePlatform === 'linux'
        ? nodePlatform
        : undefined
  const architecture =
    nodeArchitecture === 'x64'
      ? 'amd64'
      : nodeArchitecture === 'arm64'
        ? 'arm64'
        : undefined
  const target = TARGETS.find(
    (candidate) => candidate.os === osName && candidate.arch === architecture,
  )
  if (!target) {
    throw new Error(
      `unsupported Locker CLI platform ${nodePlatform}/${nodeArchitecture}`,
    )
  }
  return target
}

export function selectArtifact(manifest, identity) {
  const artifact = manifest.artifacts.find(
    (candidate) =>
      candidate.os === identity.os &&
      candidate.arch === identity.arch &&
      candidate.filename === identity.filename,
  )
  if (!artifact) {
    throw new Error('Locker CLI manifest has no exact platform artifact')
  }
  return artifact
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function compareVersions(left, right) {
  const leftMatch = VERSION_PATTERN.exec(left)
  const rightMatch = VERSION_PATTERN.exec(right)
  if (!leftMatch || !rightMatch) {
    throw new Error('Locker CLI version is invalid')
  }

  for (const component of [1, 2]) {
    const leftValue = leftMatch[component]
    const rightValue = rightMatch[component]
    if (leftValue.length !== rightValue.length) {
      return leftValue.length < rightValue.length ? -1 : 1
    }
    if (leftValue !== rightValue) {
      return leftValue < rightValue ? -1 : 1
    }
  }
  return 0
}

function channelURL(trust, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath
      .split('/')
      .some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Locker CLI release path is unsafe')
  }
  const value = new URL(relativePath, trust.baseUrl)
  const base = new URL(trust.baseUrl)
  if (
    value.protocol !== 'https:' ||
    value.origin !== base.origin ||
    value.username ||
    value.password ||
    value.search ||
    value.hash ||
    value.href !== `${trust.baseUrl}${relativePath}`
  ) {
    throw new Error('Locker CLI release URL is unsafe')
  }
  return value.href
}

function positiveInteger(value, fallback, label, maximum) {
  const resolved = value ?? fallback
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    (maximum !== undefined && resolved > maximum)
  ) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return resolved
}

export function downloadBuffer(url, maximum, timeoutMs, expectedSize) {
  return new Promise((resolve, reject) => {
    let settled = false
    let absoluteTimer
    const finish = (error, value) => {
      if (settled) {
        return
      }
      settled = true
      if (absoluteTimer !== undefined) {
        clearTimeout(absoluteTimer)
      }
      if (error) {
        reject(error)
      } else {
        resolve(value)
      }
    }
    let parsed
    try {
      parsed = new URL(url)
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error('Locker CLI download URL is unsafe')
      }
    } catch (cause) {
      finish(new Error('Locker CLI download URL is invalid', { cause }))
      return
    }
    const request = https.get(
      parsed,
      {
        headers: {
          Accept: 'application/octet-stream, application/json',
          'User-Agent': 'Locker-JS/2.0.0',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          finish(responseStatusError(response.statusCode))
          return
        }
        const declaredText = response.headers['content-length']
        if (declaredText !== undefined) {
          const declared = Number(declaredText)
          if (
            !Number.isSafeInteger(declared) ||
            declared < 1 ||
            declared > maximum ||
            (expectedSize !== undefined && declared !== expectedSize)
          ) {
            response.destroy()
            finish(new Error('Locker CLI download Content-Length is invalid'))
            return
          }
        }
        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          if (settled) {
            return
          }
          const bytes = Buffer.from(chunk)
          total += bytes.length
          if (
            total > maximum ||
            (expectedSize !== undefined && total > expectedSize)
          ) {
            response.destroy()
            for (const current of chunks) {
              current.fill(0)
            }
            bytes.fill(0)
            finish(new Error('Locker CLI download exceeds its byte limit'))
            return
          }
          chunks.push(bytes)
        })
        response.on('aborted', () => {
          for (const current of chunks) {
            current.fill(0)
          }
          finish(new UpdateNetworkError('Locker CLI download was interrupted'))
        })
        response.on('end', () => {
          if (settled) {
            return
          }
          if (
            total < 1 ||
            (expectedSize !== undefined && total !== expectedSize)
          ) {
            for (const current of chunks) {
              current.fill(0)
            }
            finish(new Error('Locker CLI download size is invalid'))
            return
          }
          finish(undefined, Buffer.concat(chunks, total))
        })
      },
    )
    absoluteTimer = setTimeout(() => {
      request.destroy(
        new UpdateNetworkError('Locker CLI download exceeded its deadline'),
      )
    }, timeoutMs)
    request.setTimeout(timeoutMs, () => {
      request.destroy(new UpdateNetworkError('Locker CLI download timed out'))
    })
    request.on('error', (cause) => {
      finish(classifyRequestError(cause))
    })
  })
}

function sameFile(before, opened) {
  return (
    opened.isFile() &&
    opened.size === before.size &&
    (before.ino === 0 ||
      (opened.ino === before.ino && opened.dev === before.dev))
  )
}

async function readRegularFile(filePath, maximum, exactSize, label) {
  let before
  try {
    before = await fs.lstat(filePath)
  } catch (cause) {
    throw new Error(`${label} is unavailable`, { cause })
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size < 1 ||
    before.size > maximum ||
    (exactSize !== undefined && before.size !== exactSize)
  ) {
    throw new Error(`${label} is not a safe regular file`)
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow)
  try {
    if (!sameFile(before, await handle.stat())) {
      throw new Error(`${label} changed while opening`)
    }
    const bytes = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (result.bytesRead === 0) {
        break
      }
      offset += result.bytesRead
    }
    if (offset !== bytes.length || !sameFile(before, await handle.stat())) {
      bytes.fill(0)
      throw new Error(`${label} changed while reading`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function verifyBinaryHeader(bytes, identity) {
  if (identity.os === 'linux') {
    if (
      bytes.length < 20 ||
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      bytes[4] !== 2 ||
      bytes[5] !== 1
    ) {
      throw new Error('Locker CLI artifact is not a 64-bit little-endian ELF')
    }
    const machine = bytes.readUInt16LE(18)
    const expected = identity.arch === 'amd64' ? 0x3e : 0xb7
    if (machine !== expected) {
      throw new Error('Locker CLI ELF architecture is invalid')
    }
    return
  }
  if (identity.os === 'darwin') {
    if (
      bytes.length < 8 ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !==
        (identity.arch === 'amd64' ? 0x01000007 : 0x0100000c)
    ) {
      throw new Error('Locker CLI Mach-O architecture is invalid')
    }
    return
  }
  if (bytes.length < 70 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('Locker CLI artifact is not an amd64 PE executable')
  }
  const peOffset = bytes.readUInt32LE(60)
  if (
    peOffset < 64 ||
    peOffset > bytes.length - 6 ||
    bytes.subarray(peOffset, peOffset + 4).toString('binary') !==
      'PE\x00\x00' ||
    bytes.readUInt16LE(peOffset + 4) !== 0x8664
  ) {
    throw new Error('Locker CLI PE architecture is invalid')
  }
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  let info = await fs.lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Locker CLI installation directory is unsafe')
  }
  if (process.platform !== 'win32') {
    if (
      typeof process.geteuid !== 'function' ||
      info.uid !== process.geteuid()
    ) {
      throw new Error('Locker CLI installation directory owner is unsafe')
    }
    await fs.chmod(directory, 0o700)
    info = await fs.lstat(directory)
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.uid !== process.geteuid() ||
      (info.mode & 0o777) !== 0o700
    ) {
      throw new Error(
        'Locker CLI installation directory permissions are unsafe',
      )
    }
  }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r').catch(() => undefined)
  if (handle) {
    await handle.sync().catch(() => undefined)
    await handle.close()
  }
}

async function writeExclusive(filePath, bytes, mode) {
  const handle = await fs.open(filePath, 'wx', mode)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (process.platform !== 'win32') {
    await fs.chmod(filePath, mode)
  }
}

async function writeAtomicJSON(filePath, value) {
  const directory = path.dirname(filePath)
  await ensurePrivateDirectory(directory)
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const bytes = Buffer.concat([canonicalJSON(value), Buffer.from('\n')])
  try {
    await writeExclusive(temporary, bytes, 0o600)
    try {
      const existing = await fs.lstat(filePath)
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error('refusing to replace an unsafe Locker CLI pointer')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    await fs.rename(temporary, filePath)
    await syncDirectory(directory)
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  } finally {
    bytes.fill(0)
  }
}

async function readCanonicalLocalJSON(filePath, fields, label) {
  let bytes
  try {
    bytes = await readRegularFile(filePath, 16 * 1024, undefined, label)
  } catch (error) {
    if (error.cause?.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  try {
    const value = exactRecord(
      parseStrictJSON(decodeUTF8(bytes, label)),
      fields,
      label,
    )
    if (
      !safeEqual(
        Buffer.concat([canonicalJSON(value), Buffer.from('\n')]),
        bytes,
      )
    ) {
      throw new Error(`${label} is not canonical`)
    }
    return value
  } finally {
    bytes.fill(0)
  }
}

async function acquireLock(lockPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const token = `${process.pid}:${randomUUID()}`
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${token}\n`, 'ascii')
      await handle.sync()
      await handle.close()
      return token
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      try {
        const info = await fs.lstat(lockPath)
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          Date.now() - info.mtimeMs > LOCK_STALE_MS
        ) {
          await fs.unlink(lockPath)
          continue
        }
      } catch (inspectError) {
        if (inspectError?.code === 'ENOENT') {
          continue
        }
        throw inspectError
      }
      if (Date.now() >= deadline) {
        throw new Error('timed out waiting for the Locker CLI update lock')
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

async function releaseLock(lockPath, token) {
  try {
    const value = await fs.readFile(lockPath, 'ascii')
    if (value !== `${token}\n`) {
      throw new Error('Locker CLI update lock ownership changed')
    }
    await fs.unlink(lockPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

function validateCurrent(value) {
  exactRecord(value, CURRENT_FIELDS, 'Locker CLI current pointer')
  if (
    value.schema !== LOCAL_CURRENT_SCHEMA ||
    value.schema_version !== SCHEMA_VERSION ||
    typeof value.version !== 'string' ||
    !VERSION_PATTERN.test(value.version) ||
    typeof value.source_commit !== 'string' ||
    !COMMIT_PATTERN.test(value.source_commit) ||
    typeof value.manifest_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.manifest_sha256) ||
    !Number.isSafeInteger(value.manifest_size) ||
    value.manifest_size < 1 ||
    value.manifest_size > MAX_MANIFEST_BYTES ||
    typeof value.artifact_filename !== 'string' ||
    typeof value.artifact_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.artifact_sha256) ||
    !Number.isSafeInteger(value.artifact_size) ||
    value.artifact_size < 1 ||
    value.artifact_size > MAX_ARTIFACT_BYTES
  ) {
    throw new Error('Locker CLI current pointer is invalid')
  }
  return value
}

function validateAccepted(value) {
  exactRecord(value, ACCEPTED_FIELDS, 'Locker CLI accepted release state')
  if (
    value.schema !== LOCAL_ACCEPTED_SCHEMA ||
    value.schema_version !== SCHEMA_VERSION ||
    typeof value.version !== 'string' ||
    !VERSION_PATTERN.test(value.version) ||
    typeof value.source_commit !== 'string' ||
    !COMMIT_PATTERN.test(value.source_commit) ||
    typeof value.manifest_sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.manifest_sha256) ||
    !Number.isSafeInteger(value.manifest_size) ||
    value.manifest_size < 1 ||
    value.manifest_size > MAX_MANIFEST_BYTES
  ) {
    throw new Error('Locker CLI accepted release state is invalid')
  }
  return value
}

async function loadAccepted(installRoot, cached) {
  const accepted = await readCanonicalLocalJSON(
    path.join(installRoot, 'locker.accepted.json'),
    ACCEPTED_FIELDS,
    'Locker CLI accepted release state',
  )
  if (!accepted) {
    return cached
      ? {
          manifest_sha256: cached.current.manifest_sha256,
          manifest_size: cached.current.manifest_size,
          schema: LOCAL_ACCEPTED_SCHEMA,
          schema_version: SCHEMA_VERSION,
          source_commit: cached.current.source_commit,
          version: cached.current.version,
        }
      : undefined
  }
  validateAccepted(accepted)
  if (cached) {
    const comparison = compareVersions(accepted.version, cached.current.version)
    if (
      comparison < 0 ||
      (comparison === 0 &&
        (accepted.source_commit !== cached.current.source_commit ||
          accepted.manifest_sha256 !== cached.current.manifest_sha256 ||
          accepted.manifest_size !== cached.current.manifest_size))
    ) {
      throw new Error(
        'Locker CLI accepted release state contradicts the current release',
      )
    }
  }
  return accepted
}

async function acceptLatest(installRoot, accepted, latest) {
  const candidate = {
    manifest_sha256: latest.manifest.sha256,
    manifest_size: latest.manifest.size,
    schema: LOCAL_ACCEPTED_SCHEMA,
    schema_version: SCHEMA_VERSION,
    source_commit: latest.sourceCommit,
    version: latest.version,
  }
  if (accepted) {
    const comparison = compareVersions(candidate.version, accepted.version)
    if (comparison < 0) {
      throw new Error('Locker CLI update channel attempted a rollback')
    }
    if (
      comparison === 0 &&
      (candidate.source_commit !== accepted.source_commit ||
        candidate.manifest_sha256 !== accepted.manifest_sha256 ||
        candidate.manifest_size !== accepted.manifest_size)
    ) {
      throw new Error('Locker CLI update channel mutated an accepted version')
    }
    if (comparison === 0) {
      return accepted
    }
  }
  await writeAtomicJSON(
    path.join(installRoot, 'locker.accepted.json'),
    candidate,
  )
  return candidate
}

async function verifyCachedRelease(installRoot, trust, identity, current) {
  validateCurrent(current)
  const releaseDirectory = path.join(installRoot, 'releases', current.version)
  const releaseInfo = await fs.lstat(releaseDirectory)
  if (releaseInfo.isSymbolicLink() || !releaseInfo.isDirectory()) {
    throw new Error('Locker CLI release directory is unsafe')
  }
  const manifestPath = path.join(releaseDirectory, 'manifest.json')
  const manifestBytes = await readRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    current.manifest_size,
    'cached Locker CLI manifest',
  )
  try {
    if (sha256(manifestBytes) !== current.manifest_sha256) {
      throw new Error('cached Locker CLI manifest hash is invalid')
    }
    const manifest = parseManifest(manifestBytes, trust)
    if (
      manifest.version !== current.version ||
      manifest.sourceCommit !== current.source_commit
    ) {
      throw new Error('cached Locker CLI manifest provenance is invalid')
    }
    const artifact = selectArtifact(manifest, identity)
    if (
      artifact.filename !== current.artifact_filename ||
      artifact.sha256 !== current.artifact_sha256 ||
      artifact.size !== current.artifact_size
    ) {
      throw new Error('cached Locker CLI artifact pointer is invalid')
    }
    const binaryPath = path.join(releaseDirectory, artifact.filename)
    const binary = await readRegularFile(
      binaryPath,
      MAX_ARTIFACT_BYTES,
      artifact.size,
      'cached Locker CLI artifact',
    )
    const signature = await readRegularFile(
      path.join(releaseDirectory, `${artifact.filename}.sig`),
      SIGNATURE_BYTES,
      SIGNATURE_BYTES,
      'cached Locker CLI artifact signature',
    )
    try {
      if (sha256(binary) !== artifact.sha256) {
        throw new Error('cached Locker CLI artifact hash is invalid')
      }
      verifyEd25519(binary, signature, trust)
      verifyBinaryHeader(binary, identity)
    } finally {
      binary.fill(0)
      signature.fill(0)
    }
    if (process.platform !== 'win32') {
      await fs.access(binaryPath, fsConstants.X_OK)
    }
    const names = (await fs.readdir(releaseDirectory)).sort()
    const expected = [
      artifact.filename,
      `${artifact.filename}.sig`,
      'manifest.json',
    ].sort()
    if (
      names.length !== expected.length ||
      names.some((name, index) => name !== expected[index])
    ) {
      throw new Error('cached Locker CLI release directory has extra files')
    }
    return {
      path: binaryPath,
      current,
      manifest,
      artifact,
    }
  } finally {
    manifestBytes.fill(0)
  }
}

function parseCheckState(check, current) {
  if (!check) {
    return undefined
  }
  exactRecord(check, CHECK_FIELDS, 'Locker CLI update check pointer')
  if (
    check.schema === LOCAL_CHECK_SCHEMA &&
    check.schema_version === SCHEMA_VERSION &&
    check.version === current.version &&
    check.source_commit === current.source_commit &&
    check.manifest_sha256 === current.manifest_sha256 &&
    (check.checked_at_unix === null ||
      (Number.isSafeInteger(check.checked_at_unix) &&
        check.checked_at_unix >= 0)) &&
    Number.isSafeInteger(check.retry_after_unix) &&
    check.retry_after_unix >= 0
  ) {
    return {
      checkedAtUnix: check.checked_at_unix,
      retryAfterUnix: check.retry_after_unix,
    }
  }
  return undefined
}

function nextCheckDeadline(
  check,
  current,
  nowSeconds,
  pendingAcceptedRelease = false,
) {
  const state = parseCheckState(check, current)
  if (!state) {
    return undefined
  }
  if (state.retryAfterUnix > 0) {
    if (
      state.retryAfterUnix > nowSeconds &&
      state.retryAfterUnix - nowSeconds <= UPDATE_RETRY_SECONDS
    ) {
      return state.retryAfterUnix
    }
    return undefined
  }
  if (pendingAcceptedRelease) {
    return undefined
  }
  if (
    state.checkedAtUnix !== null &&
    state.checkedAtUnix <= nowSeconds &&
    nowSeconds - state.checkedAtUnix < CHECK_INTERVAL_SECONDS
  ) {
    return state.checkedAtUnix + CHECK_INTERVAL_SECONDS
  }
  return undefined
}

async function loadCached(installRoot, trust, identity) {
  const pointerPath = path.join(installRoot, 'locker.current.json')
  const current = await readCanonicalLocalJSON(
    pointerPath,
    CURRENT_FIELDS,
    'Locker CLI current pointer',
  )
  if (!current) {
    return undefined
  }
  return await verifyCachedRelease(installRoot, trust, identity, current)
}

async function publishRelease(
  installRoot,
  trust,
  identity,
  manifestBytes,
  manifest,
  artifact,
  binary,
  signature,
) {
  if (binary.length !== artifact.size || sha256(binary) !== artifact.sha256) {
    throw new Error('Locker CLI artifact size or SHA-256 is invalid')
  }
  verifyEd25519(binary, signature, trust)
  verifyBinaryHeader(binary, identity)
  const releases = path.join(installRoot, 'releases')
  await ensurePrivateDirectory(releases)
  const destination = path.join(releases, manifest.version)
  const staging = path.join(
    releases,
    `.${manifest.version}.${process.pid}.${randomUUID()}.tmp`,
  )
  await fs.mkdir(staging, { mode: 0o700 })
  let published = false
  try {
    await writeExclusive(
      path.join(staging, artifact.filename),
      binary,
      process.platform === 'win32' ? 0o600 : 0o700,
    )
    await writeExclusive(
      path.join(staging, `${artifact.filename}.sig`),
      signature,
      0o600,
    )
    await writeExclusive(
      path.join(staging, 'manifest.json'),
      manifestBytes,
      0o600,
    )
    await syncDirectory(staging)
    try {
      await fs.rename(staging, destination)
      published = true
      await syncDirectory(releases)
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') {
        throw error
      }
    }
  } finally {
    if (!published) {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
  const current = {
    artifact_filename: artifact.filename,
    artifact_sha256: artifact.sha256,
    artifact_size: artifact.size,
    manifest_sha256: sha256(manifestBytes),
    manifest_size: manifestBytes.length,
    schema: LOCAL_CURRENT_SCHEMA,
    schema_version: SCHEMA_VERSION,
    source_commit: manifest.sourceCommit,
    version: manifest.version,
  }
  const verified = await verifyCachedRelease(
    installRoot,
    trust,
    identity,
    current,
  )
  await writeAtomicJSON(path.join(installRoot, 'locker.current.json'), current)
  return verified
}

async function cachedNetworkFallback(
  error,
  cached,
  nowSeconds,
  installRoot,
  check,
) {
  if (!(error instanceof UpdateNetworkError) || !cached) {
    throw error
  }
  const priorState = parseCheckState(check, cached.current)
  const retryAfterUnix = nowSeconds + UPDATE_RETRY_SECONDS
  await writeAtomicJSON(path.join(installRoot, 'locker.check.json'), {
    checked_at_unix: priorState?.checkedAtUnix ?? null,
    manifest_sha256: cached.current.manifest_sha256,
    retry_after_unix: retryAfterUnix,
    schema: LOCAL_CHECK_SCHEMA,
    schema_version: SCHEMA_VERSION,
    source_commit: cached.current.source_commit,
    version: cached.current.version,
  })
  return {
    path: cached.path,
    reused: true,
    checked: false,
    nextCheckAtUnix: retryAfterUnix,
    message:
      `Using verified cached Locker CLI ${cached.current.version} ` +
      'because the update channel is unreachable',
  }
}

export async function installManagedCLI(options = {}) {
  const explicitPath = options.explicitPath ?? process.env.LOCKER_CLI_PATH
  if (explicitPath?.trim()) {
    if (!path.isAbsolute(explicitPath)) {
      throw new Error('LOCKER_CLI_PATH and explicitPath must be absolute paths')
    }
    const selectedInfo = await fs.lstat(explicitPath)
    if (selectedInfo.isSymbolicLink() || !selectedInfo.isFile()) {
      throw new Error('LOCKER_CLI_PATH must reference a regular non-link file')
    }
    const resolved = await fs.realpath(explicitPath)
    const info = await fs.lstat(resolved)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('LOCKER_CLI_PATH must reference a regular non-link file')
    }
    if (process.platform !== 'win32') {
      await fs.access(resolved, fsConstants.X_OK)
    }
    return {
      path: resolved,
      reused: true,
      checked: false,
      message: `Using explicit Locker CLI at ${resolved}`,
    }
  }

  const packageRoot =
    options.packageRoot ?? fileURLToPath(new URL('../', import.meta.url))
  const configurationPath =
    options.configurationPath ??
    path.join(packageRoot, 'locker-cli-release.json')
  const trust = options.trust
    ? validateTrust(options.trust)
    : await loadReleaseTrust(configurationPath)
  const identity =
    options.identity ??
    platformIdentity(options.nodePlatform, options.nodeArchitecture)
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const lockerRoot = path.join(homeDirectory, '.locker')
  const sdkRoot = path.join(lockerRoot, 'sdk-cli')
  const installRoot = options.installRoot ?? path.join(sdkRoot, 'nodejs')
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    'timeoutMs',
    120_000,
  )
  const lockTimeoutMs = positiveInteger(
    options.lockTimeoutMs,
    DEFAULT_LOCK_TIMEOUT_MS,
    'lockTimeoutMs',
    120_000,
  )
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new RangeError('nowSeconds must be a non-negative safe integer')
  }
  const download = options.downloadBuffer ?? downloadBuffer

  if (options.installRoot === undefined) {
    // Validate each managed ancestor before creating the next component.
    // A recursive mkdir of only the leaf would otherwise follow a substituted
    // ~/.locker or sdk-cli symlink/junction without ever lstat'ing it.
    await ensurePrivateDirectory(lockerRoot)
    await ensurePrivateDirectory(sdkRoot)
  }
  await ensurePrivateDirectory(installRoot)
  const lockPath = path.join(installRoot, '.locker-cli-update.lock')
  const token = await acquireLock(lockPath, lockTimeoutMs)
  try {
    const cached = await loadCached(installRoot, trust, identity)
    const accepted = await loadAccepted(installRoot, cached)
    const check = await readCanonicalLocalJSON(
      path.join(installRoot, 'locker.check.json'),
      CHECK_FIELDS,
      'Locker CLI update check pointer',
    )
    const pendingAcceptedRelease = Boolean(
      cached &&
      accepted &&
      compareVersions(accepted.version, cached.current.version) > 0,
    )
    const nextCheckAtUnix =
      cached && !options.forceCheck
        ? nextCheckDeadline(
            check,
            cached.current,
            nowSeconds,
            pendingAcceptedRelease,
          )
        : undefined
    if (cached && nextCheckAtUnix !== undefined) {
      return {
        path: cached.path,
        reused: true,
        checked: false,
        nextCheckAtUnix,
        message: `Using verified Locker CLI ${cached.current.version}`,
      }
    }

    let latestBytes
    try {
      latestBytes = await download(
        channelURL(trust, 'latest.json'),
        MAX_LATEST_BYTES,
        timeoutMs,
        undefined,
      )
    } catch (error) {
      return await cachedNetworkFallback(
        error,
        cached,
        nowSeconds,
        installRoot,
        check,
      )
    }
    try {
      const latest = parseLatest(latestBytes, trust)
      await acceptLatest(installRoot, accepted, latest)
      if (
        cached &&
        compareVersions(latest.version, cached.current.version) < 0
      ) {
        throw new Error('Locker CLI update channel attempted a rollback')
      }
      let manifestBytes
      try {
        manifestBytes = await download(
          channelURL(trust, latest.manifest.path),
          MAX_MANIFEST_BYTES,
          timeoutMs,
          latest.manifest.size,
        )
      } catch (error) {
        return await cachedNetworkFallback(
          error,
          cached,
          nowSeconds,
          installRoot,
          check,
        )
      }
      try {
        if (sha256(manifestBytes) !== latest.manifest.sha256) {
          throw new Error('Locker CLI manifest SHA-256 is invalid')
        }
        const manifest = parseManifest(manifestBytes, trust)
        if (
          manifest.version !== latest.version ||
          manifest.sourceCommit !== latest.sourceCommit
        ) {
          throw new Error(
            'Locker CLI latest metadata does not bind manifest provenance',
          )
        }
        if (cached && latest.version === cached.current.version) {
          if (latest.manifest.sha256 !== cached.current.manifest_sha256) {
            throw new Error(
              'Locker CLI update channel mutated an existing version',
            )
          }
          await writeAtomicJSON(path.join(installRoot, 'locker.check.json'), {
            checked_at_unix: nowSeconds,
            manifest_sha256: latest.manifest.sha256,
            retry_after_unix: 0,
            schema: LOCAL_CHECK_SCHEMA,
            schema_version: SCHEMA_VERSION,
            source_commit: latest.sourceCommit,
            version: latest.version,
          })
          return {
            path: cached.path,
            reused: true,
            checked: true,
            nextCheckAtUnix: nowSeconds + CHECK_INTERVAL_SECONDS,
            message: `Locker CLI ${latest.version} is current`,
          }
        }
        const artifact = selectArtifact(manifest, identity)
        let binary
        try {
          binary = await download(
            channelURL(trust, artifact.path),
            MAX_ARTIFACT_BYTES,
            timeoutMs,
            artifact.size,
          )
        } catch (error) {
          return await cachedNetworkFallback(
            error,
            cached,
            nowSeconds,
            installRoot,
            check,
          )
        }
        try {
          let signature
          try {
            signature = await download(
              channelURL(trust, artifact.signaturePath),
              SIGNATURE_BYTES,
              timeoutMs,
              SIGNATURE_BYTES,
            )
          } catch (error) {
            return await cachedNetworkFallback(
              error,
              cached,
              nowSeconds,
              installRoot,
              check,
            )
          }
          try {
            const installed = await publishRelease(
              installRoot,
              trust,
              identity,
              manifestBytes,
              manifest,
              artifact,
              binary,
              signature,
            )
            await writeAtomicJSON(path.join(installRoot, 'locker.check.json'), {
              checked_at_unix: nowSeconds,
              manifest_sha256: latest.manifest.sha256,
              retry_after_unix: 0,
              schema: LOCAL_CHECK_SCHEMA,
              schema_version: SCHEMA_VERSION,
              source_commit: latest.sourceCommit,
              version: latest.version,
            })
            return {
              path: installed.path,
              reused: false,
              checked: true,
              nextCheckAtUnix: nowSeconds + CHECK_INTERVAL_SECONDS,
              message: `Installed verified Locker CLI ${latest.version}`,
            }
          } finally {
            signature.fill(0)
          }
        } finally {
          binary.fill(0)
        }
      } finally {
        manifestBytes.fill(0)
      }
    } finally {
      latestBytes.fill(0)
    }
  } finally {
    await releaseLock(lockPath, token)
  }
}

function parseArguments(arguments_) {
  const options = { managedJSON: false }
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index]
    if (name === '--managed-json') {
      options.managedJSON = true
      continue
    }
    const value = arguments_[index + 1]
    if (!['--package-root', '--home'].includes(name) || value === undefined) {
      throw new Error('Locker CLI installer arguments are invalid')
    }
    options[name === '--package-root' ? 'packageRoot' : 'homeDirectory'] = value
    index += 1
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const result = await installManagedCLI(options)
  if (options.managedJSON) {
    process.stdout.write(
      `${JSON.stringify({
        checked: result.checked,
        next_check_at_unix: result.nextCheckAtUnix,
        path: result.path,
        reused: result.reused,
      })}\n`,
    )
  } else {
    process.stdout.write(`${result.message}\n`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : 'unknown Locker CLI installer failure'
    process.stderr.write(`Locker CLI installation failed: ${message}\n`)
    process.exitCode = 1
  })
}
