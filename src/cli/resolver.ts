import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { SDK_VERSION } from '../version.js'
import { parseStrictJSON } from '../utils/json.js'

const COMPILED_MODULE_PATH = '__LOCKER_COMPILED_MODULE_PATH__'
const BASE_URL = 'https://files.locker.io/cli/releases/'
const KEY_ID = 'locker-cli-release-v1'
const CHECK_INTERVAL_SECONDS = 21_600
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024
const HELPER_TIMEOUT_MS = 150_000
const VERSION_PATTERN = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
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
  'next_check_at_unix',
  'path',
  'reused',
])

type TrustState = 'configured' | 'unconfigured'

type ManagedResolution = {
  path: string
  nextCheckAtMs: number
  homeDirectory: string
  packageRoot: string
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
): { path: string; nextCheckAtMs: number } {
  if (!isRecord(value) || !hasExactFields(value, RESULT_FIELDS)) {
    throw new Error('Locker CLI update helper returned an invalid result')
  }
  if (
    typeof value.checked !== 'boolean' ||
    typeof value.reused !== 'boolean' ||
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
    path: resolved,
    nextCheckAtMs: (value.next_check_at_unix as number) * 1000,
  }
}

function runManagedUpdate(
  packageRoot: string,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  installerScript?: string,
): ManagedResolution {
  const script =
    installerScript ?? path.join(packageRoot, 'scripts', 'install-cli.mjs')
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--managed-json',
      '--package-root',
      packageRoot,
      '--home',
      homeDirectory,
    ],
    {
      encoding: 'utf8',
      env: helperEnvironment(environment),
      maxBuffer: MAX_HELPER_OUTPUT_BYTES,
      shell: false,
      timeout: HELPER_TIMEOUT_MS,
      windowsHide: true,
    },
  )
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

export function resolveDefaultCLIPath(
  options: {
    environment?: NodeJS.ProcessEnv
    homeDirectory?: string
    packageRoot?: string
    installerScript?: string
    nowMs?: number
  } = {},
): string {
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
  )
  return managedResolution.path
}

export function resolveCLIPath(explicitPath?: string): string {
  const selected = explicitPath ?? resolveDefaultCLIPath()
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
