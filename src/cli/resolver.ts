import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { SDK_VERSION } from '../version.js'
import { parseStrictJSON } from '../utils/json.js'

const COMPILED_MODULE_PATH = '__LOCKER_COMPILED_MODULE_PATH__'
const COMPILED_MODULE_FORMAT: string = '__LOCKER_COMPILED_MODULE_FORMAT__'
const BASE_URL = 'https://files.locker.io/cli/releases/'
const KEY_ID = 'locker-cli-release-v1'
const CHECK_INTERVAL_SECONDS = 21_600
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024
const HELPER_TIMEOUT_MS = 150_000
const VERSION_PATTERN = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const TRUST_FIELDS = new Set([
  'base_url',
  'check_interval_seconds',
  'key_id',
  'public_key',
  'schema_version',
])
const RESULT_FIELDS = new Set([
  'checked',
  'generation',
  'next_check_at_unix',
  'path',
  'reused',
])

type TrustState = 'configured' | 'unconfigured'

type ManagedResolution = {
  generation: string
  path: string
  nextCheckAtMs: number
  homeDirectory: string
  packageRoot: string
}

export class CLIResolutionTimeoutError extends Error {
  constructor() {
    super('Locker CLI signed update helper exceeded its timeout')
    this.name = 'CLIResolutionTimeoutError'
  }
}

export class CLIResolutionCancelledError extends Error {
  constructor() {
    super('Locker CLI resolution was cancelled')
    this.name = 'CLIResolutionCancelledError'
  }
}

let cachedTrust:
  | {
      packageRoot: string
      state: TrustState
    }
  | undefined
let managedResolution: ManagedResolution | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value)
  return keys.length === fields.size && keys.every((field) => fields.has(field))
}

function findPackageRoot(entry: string): string | undefined {
  let current = path.dirname(entry)
  for (let depth = 0; depth < 8; depth += 1) {
    const packagePath = path.join(current, 'package.json')
    try {
      const contents = parseStrictJSON(
        fs.readFileSync(packagePath, 'utf8'),
      ) as {
        name?: unknown
        version?: unknown
      }
      if (contents.name === 'lockersm' && contents.version === SDK_VERSION) {
        return current
      }
    } catch {
      // Continue walking toward the filesystem root.
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return undefined
}

function resolvePackageRoot(): string | undefined {
  return findPackageRoot(COMPILED_MODULE_PATH)
}

function releaseTrustState(packageRoot: string): TrustState {
  if (cachedTrust?.packageRoot === packageRoot) {
    return cachedTrust.state
  }
  const configurationPath = path.join(packageRoot, 'locker-cli-release.json')
  const info = fs.lstatSync(configurationPath)
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.size < 1 ||
    info.size > 16 * 1024
  ) {
    throw new Error('Locker CLI release trust resource is unsafe')
  }
  const value = parseStrictJSON(
    new TextDecoder('utf-8', { fatal: true }).decode(
      fs.readFileSync(configurationPath),
    ),
    64,
  )
  if (!isRecord(value) || !hasExactFields(value, TRUST_FIELDS)) {
    throw new Error('Locker CLI release trust resource has invalid fields')
  }
  if (
    value.schema_version !== 2 ||
    value.base_url !== BASE_URL ||
    value.key_id !== KEY_ID ||
    value.check_interval_seconds !== CHECK_INTERVAL_SECONDS ||
    typeof value.public_key !== 'string'
  ) {
    throw new Error('Locker CLI release trust resource is invalid')
  }
  let state: TrustState
  if (value.public_key === '') {
    state = 'unconfigured'
  } else {
    const key = Buffer.from(value.public_key, 'base64url')
    if (
      !BASE64URL_PATTERN.test(value.public_key) ||
      value.public_key.includes('=') ||
      key.length !== 32 ||
      key.toString('base64url') !== value.public_key
    ) {
      key.fill(0)
      throw new Error('Locker CLI release trust root is invalid')
    }
    key.fill(0)
    state = 'configured'
  }
  cachedTrust = { packageRoot, state }
  return state
}

function helperEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const name of [
    'LANG',
    'LC_ALL',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
  ]) {
    const value = environment[name]
    if (value !== undefined) {
      result[name] = value
    }
  }
  return result
}

function validateManagedResult(
  value: unknown,
  homeDirectory: string,
): { generation: string; path: string; nextCheckAtMs: number } {
  if (!isRecord(value) || !hasExactFields(value, RESULT_FIELDS)) {
    throw new Error('Locker CLI update helper returned an invalid result')
  }
  if (
    typeof value.checked !== 'boolean' ||
    typeof value.reused !== 'boolean' ||
    typeof value.generation !== 'string' ||
    !SHA256_PATTERN.test(value.generation) ||
    typeof value.path !== 'string' ||
    !Number.isSafeInteger(value.next_check_at_unix) ||
    (value.next_check_at_unix as number) < 0
  ) {
    throw new Error('Locker CLI update helper returned invalid fields')
  }
  const resolved = path.resolve(value.path)
  const releases = path.resolve(
    homeDirectory,
    '.locker',
    'sdk-cli',
    'nodejs',
    'releases',
  )
  const relative = path.relative(releases, resolved)
  const parts = relative.split(path.sep)
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    parts.length !== 2 ||
    !VERSION_PATTERN.test(parts[0]) ||
    ![
      'locker-linux-amd64',
      'locker-linux-arm64',
      'locker-darwin-amd64',
      'locker-darwin-arm64',
      'locker-windows-amd64.exe',
    ].includes(parts[1])
  ) {
    throw new Error('Locker CLI update helper returned an unsafe path')
  }
  const info = fs.lstatSync(resolved)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Locker CLI update helper returned a non-regular file')
  }
  if (process.platform !== 'win32') {
    fs.accessSync(resolved, fs.constants.X_OK)
  }
  return {
    generation: value.generation,
    path: resolved,
    nextCheckAtMs: (value.next_check_at_unix as number) * 1000,
  }
}

function runManagedHelper(
  mode: '--managed-json' | '--verify-managed-json',
  packageRoot: string,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  installerScript?: string,
  timeoutMs = HELPER_TIMEOUT_MS,
  expectedPath?: string,
): ManagedResolution {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CLIResolutionTimeoutError()
  }
  const script =
    installerScript ?? path.join(packageRoot, 'scripts', 'install-cli.mjs')
  const arguments_ = [
    script,
    mode,
    '--package-root',
    packageRoot,
    '--home',
    homeDirectory,
  ]
  if (mode === '--verify-managed-json' && expectedPath !== undefined) {
    arguments_.push('--expected-path', expectedPath)
  }
  if (
    mode === '--verify-managed-json' &&
    managedResolution?.packageRoot === packageRoot &&
    managedResolution.homeDirectory === homeDirectory
  ) {
    arguments_.push('--expected-generation', managedResolution.generation)
  }
  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8',
    env: helperEnvironment(environment),
    maxBuffer: MAX_HELPER_OUTPUT_BYTES,
    shell: false,
    timeout: Math.min(timeoutMs, HELPER_TIMEOUT_MS),
    windowsHide: true,
  })
  if (
    (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  ) {
    throw new CLIResolutionTimeoutError()
  }
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    typeof result.stdout !== 'string' ||
    result.stdout.length < 2 ||
    Buffer.byteLength(result.stdout, 'utf8') > MAX_HELPER_OUTPUT_BYTES
  ) {
    throw new Error('Locker CLI signed update helper failed closed', {
      cause: result.error,
    })
  }
  const parsed = parseStrictJSON(result.stdout, 8)
  const managed = validateManagedResult(parsed, homeDirectory)
  return {
    ...managed,
    homeDirectory,
    packageRoot,
  }
}

function runManagedUpdate(
  packageRoot: string,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  installerScript?: string,
  timeoutMs = HELPER_TIMEOUT_MS,
): ManagedResolution {
  return runManagedHelper(
    '--managed-json',
    packageRoot,
    homeDirectory,
    environment,
    installerScript,
    timeoutMs,
  )
}

function runManagedVerification(
  packageRoot: string,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  installerScript?: string,
  timeoutMs = HELPER_TIMEOUT_MS,
  expectedPath?: string,
): ManagedResolution {
  return runManagedHelper(
    '--verify-managed-json',
    packageRoot,
    homeDirectory,
    environment,
    installerScript,
    timeoutMs,
    expectedPath,
  )
}

export function resolveDefaultCLIPath(
  options: {
    environment?: NodeJS.ProcessEnv
    homeDirectory?: string
    packageRoot?: string
    installerScript?: string
    nowMs?: number
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): string {
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CLIResolutionTimeoutError()
  }
  const environment = options.environment ?? process.env
  const configured = environment.LOCKER_CLI_PATH?.trim()
  if (configured) {
    return configured
  }
  const packageRoot = options.packageRoot ?? resolvePackageRoot()
  if (!packageRoot) {
    throw new Error(
      'Locker SDK package trust metadata is unavailable; set an explicit cliPath',
    )
  }
  if (releaseTrustState(packageRoot) === 'unconfigured') {
    throw new Error(
      'Locker CLI release trust is unprovisioned; set an explicit cliPath or LOCKER_CLI_PATH',
    )
  }
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const nowMs = options.nowMs ?? Date.now()
  if (
    managedResolution?.packageRoot === packageRoot &&
    managedResolution.homeDirectory === homeDirectory &&
    nowMs < managedResolution.nextCheckAtMs
  ) {
    return managedResolution.path
  }
  managedResolution = runManagedUpdate(
    packageRoot,
    homeDirectory,
    environment,
    options.installerScript,
    timeoutMs,
  )
  return managedResolution.path
}

export function resolveCLIPath(
  explicitPath?: string,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): string {
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const selected = explicitPath ?? resolveDefaultCLIPath(options)
  return normalizeCLIPath(selected)
}

function normalizeCLIPath(selected: string): string {
  if (selected.trim() === '') {
    throw new Error('Locker CLI path must not be empty')
  }
  if (!path.isAbsolute(selected)) {
    throw new Error(
      'Locker CLI cliPath and LOCKER_CLI_PATH must be absolute paths',
    )
  }

  const selectedInfo = fs.lstatSync(selected)
  if (selectedInfo.isSymbolicLink() || !selectedInfo.isFile()) {
    throw new Error('Locker CLI path must reference a regular non-link file')
  }
  const resolved = fs.realpathSync.native(selected)
  const info = fs.lstatSync(resolved)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Locker CLI path must reference a regular non-link file')
  }
  if (process.platform !== 'win32') {
    fs.accessSync(resolved, fs.constants.X_OK)
  }
  return resolved
}

// Resolve the exact executable to be spawned at the last local trust boundary.
// Explicit caller-owned paths keep their documented trust semantics. Managed
// paths are re-verified through the bundled network-free verifier. Every
// spawn validates the trust root, canonical pointer, signed manifest, and a
// streaming SHA-256/size/header pass. A newly selected immutable generation
// additionally receives full detached Ed25519 artifact verification.
export function bindCLIPathForExecution(
  explicitPath: string | undefined,
  options: {
    environment?: NodeJS.ProcessEnv
    homeDirectory?: string
    packageRoot?: string
    installerScript?: string
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): string {
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CLIResolutionTimeoutError()
  }
  const environment = options.environment ?? process.env
  if (explicitPath !== undefined) {
    return resolveCLIPath(explicitPath, options)
  }
  const environmentPath = environment.LOCKER_CLI_PATH?.trim()
  if (environmentPath) {
    return resolveCLIPath(environmentPath, options)
  }
  const packageRoot = options.packageRoot ?? resolvePackageRoot()
  if (!packageRoot) {
    throw new Error(
      'Locker SDK package trust metadata is unavailable; set an explicit cliPath',
    )
  }
  if (releaseTrustState(packageRoot) === 'unconfigured') {
    throw new Error(
      'Locker CLI release trust is unprovisioned; set an explicit cliPath or LOCKER_CLI_PATH',
    )
  }
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const verified = runManagedVerification(
    packageRoot,
    homeDirectory,
    environment,
    options.installerScript,
    timeoutMs,
    managedResolution?.packageRoot === packageRoot &&
      managedResolution.homeDirectory === homeDirectory
      ? managedResolution.path
      : undefined,
  )
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const resolved = normalizeCLIPath(verified.path)
  if (
    managedResolution?.packageRoot === packageRoot &&
    managedResolution.homeDirectory === homeDirectory
  ) {
    managedResolution = {
      ...managedResolution,
      generation: verified.generation,
      path: resolved,
    }
  }
  return resolved
}

// Async callers can reuse the already loaded installer module instead of
// paying for a fresh Node.js helper process on every execution. The verifier
// remains the single implementation of the signed-manifest/hash/signature
// contract; its streaming read receives an abort signal as part of the
// caller's total operation budget.
export async function bindCLIPathForExecutionAsync(
  explicitPath: string | undefined,
  options: {
    environment?: NodeJS.ProcessEnv
    homeDirectory?: string
    packageRoot?: string
    installerScript?: string
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CLIResolutionTimeoutError()
  }
  const environment = options.environment ?? process.env
  if (explicitPath !== undefined || environment.LOCKER_CLI_PATH?.trim()) {
    return bindCLIPathForExecution(explicitPath, options)
  }
  const packageRoot = options.packageRoot ?? resolvePackageRoot()
  if (!packageRoot) {
    throw new Error(
      'Locker SDK package trust metadata is unavailable; set an explicit cliPath',
    )
  }
  if (releaseTrustState(packageRoot) === 'unconfigured') {
    throw new Error(
      'Locker CLI release trust is unprovisioned; set an explicit cliPath or LOCKER_CLI_PATH',
    )
  }
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const script =
    options.installerScript ??
    path.join(packageRoot, 'scripts', 'install-cli.mjs')
  const expectedPath =
    managedResolution?.packageRoot === packageRoot &&
    managedResolution.homeDirectory === homeDirectory
      ? managedResolution.path
      : undefined
  const verificationController = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      verificationController.abort()
      reject(new CLIResolutionTimeoutError())
    }, timeoutMs)
  })
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (!options.signal) {
      return
    }
    abortHandler = () => {
      verificationController.abort(options.signal?.reason)
      reject(new CLIResolutionCancelledError())
    }
    options.signal.addEventListener('abort', abortHandler, { once: true })
  })
  const verification = (async (): Promise<ManagedResolution> => {
    try {
      const moduleSpecifier =
        COMPILED_MODULE_FORMAT === 'cjs' ? script : pathToFileURL(script).href
      const loaded = (await import(moduleSpecifier)) as {
        verifyManagedCLI?: (configuration: {
          expectedGeneration?: string
          expectedPath?: string
          homeDirectory: string
          packageRoot: string
          signal: AbortSignal
        }) => Promise<{
          generation?: string
          path: string
          nextCheckAtUnix?: number
        }>
      }
      if (typeof loaded.verifyManagedCLI !== 'function') {
        throw new Error('Locker CLI managed verifier is unavailable')
      }
      const result = await loaded.verifyManagedCLI({
        expectedGeneration:
          expectedPath === undefined
            ? undefined
            : managedResolution?.generation,
        expectedPath,
        homeDirectory,
        packageRoot,
        signal: verificationController.signal,
      })
      if (
        typeof result.generation !== 'string' ||
        !SHA256_PATTERN.test(result.generation)
      ) {
        throw new Error(
          'Locker CLI managed verifier returned an invalid generation',
        )
      }
      return {
        generation: result.generation,
        path: result.path,
        nextCheckAtMs: (result.nextCheckAtUnix ?? 0) * 1000,
        homeDirectory,
        packageRoot,
      }
    } catch (cause) {
      if (options.signal?.aborted) {
        throw new CLIResolutionCancelledError()
      }
      if (timedOut) {
        throw new CLIResolutionTimeoutError()
      }
      throw cause
    }
  })()

  let verified: ManagedResolution
  try {
    verified = await Promise.race([verification, timeout, cancellation])
  } finally {
    verificationController.abort()
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
    if (options.signal && abortHandler) {
      options.signal.removeEventListener('abort', abortHandler)
    }
  }
  if (options.signal?.aborted) {
    throw new CLIResolutionCancelledError()
  }
  const resolved = normalizeCLIPath(verified.path)
  if (
    managedResolution?.packageRoot === packageRoot &&
    managedResolution.homeDirectory === homeDirectory
  ) {
    managedResolution = {
      ...managedResolution,
      generation: verified.generation,
      path: resolved,
    }
  }
  return resolved
}
