import process from 'node:process'
import {
  ErrorCode,
  LogLevel,
  errorFromResponse,
  isLockerNotFoundError,
  type CacheOptions,
  type ExportFormat,
  type IEnvironmentPage,
  type ILockerSecret,
  type ISecretPage,
  type LockerOptions,
  type PageRequest,
  type ProtocolExecutor,
  type VaultContext,
} from './abstraction/index.js'
import { BinaryExecutor } from './executors/binary.js'
import { Environment, Secret } from './resources/index.js'
import { Converter } from './utils/converter.js'
import {
  formatSecrets,
  readUTF8FileBounded,
  writePrivateFileAtomically,
} from './utils/files.js'
import { MAX_IMPORT_BYTES, parseImport } from './utils/import.js'
import { Logger } from './utils/logger.js'

const DEFAULT_BASE_API = 'https://api.locker.io/locker_secrets'
const DEFAULT_LOG_LEVEL = LogLevel.ERROR
const MAX_PROTOCOL_NAME_LENGTH = 65_536
const MAX_API_BASE_LENGTH = 4_096
const MAX_HEADER_COUNT = 64
const MAX_CACHE_AGE_SECONDS = 86_400
const MAX_LIST_PAGE_SIZE = 1_000
const MAX_LIST_CURSOR_BYTES = 4_096
const ACCESS_KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CREDENTIAL_VALIDATION_REQUEST_ID = 'credential-validation'

type EnvironmentSource = Readonly<Record<string, string | undefined>>

type NormalizedCredentials = {
  accessKeyId: string
  secretAccessKey: string
}

function requireString(
  value: unknown,
  name: string,
  maxLength = MAX_PROTOCOL_NAME_LENGTH,
): string {
  if (typeof value !== 'string' || value === '' || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function requireStringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
  return value
}

function optionalStringValue(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireStringValue(value, name)
}

function optionalEnvironment(value: unknown): string | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  return requireString(value, 'environment')
}

function validateHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('headers must be an object of string values')
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_HEADER_COUNT) {
    throw new RangeError(
      `headers must contain at most ${MAX_HEADER_COUNT} fields`,
    )
  }
  const result = Object.create(null) as Record<string, string>
  for (const [name, headerValue] of entries) {
    if (typeof headerValue !== 'string') {
      throw new TypeError(`header ${JSON.stringify(name)} must be a string`)
    }
    result[name] = headerValue
  }
  return result
}

function validateCacheOptions(
  value: CacheOptions | undefined,
): CacheOptions | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('cache options must be an object')
  }
  if (value.fetch !== undefined && typeof value.fetch !== 'boolean') {
    throw new TypeError('fetch must be a boolean')
  }
  if (
    value.restTime !== undefined &&
    (!Number.isSafeInteger(value.restTime) ||
      value.restTime < 0 ||
      value.restTime > MAX_CACHE_AGE_SECONDS)
  ) {
    throw new RangeError(
      `restTime must be an integer from 0 to ${MAX_CACHE_AGE_SECONDS}`,
    )
  }
  if (
    value.timeoutMs !== undefined &&
    (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0)
  ) {
    throw new RangeError('timeoutMs must be a positive safe integer')
  }
  return value
}

function pageParams(value: PageRequest | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('page request must be an object')
  }
  const params: Record<string, unknown> = {}
  if (value.pageSize !== undefined) {
    if (
      !Number.isSafeInteger(value.pageSize) ||
      value.pageSize < 1 ||
      value.pageSize > MAX_LIST_PAGE_SIZE
    ) {
      throw new RangeError(
        `pageSize must be an integer from 1 to ${MAX_LIST_PAGE_SIZE}`,
      )
    }
    params.page_size = value.pageSize
  }
  if (value.cursor !== undefined) {
    if (
      typeof value.cursor !== 'string' ||
      value.cursor.length === 0 ||
      Buffer.byteLength(value.cursor, 'utf8') > MAX_LIST_CURSOR_BYTES
    ) {
      throw new TypeError(
        `cursor must be a non-empty string of at most ${MAX_LIST_CURSOR_BYTES} bytes`,
      )
    }
    params.cursor = value.cursor
  }
  return params
}

function firstEnvironmentValue(
  environment: EnvironmentSource,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = environment[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return undefined
}

function credentialError(kind: string): never {
  throw errorFromResponse(
    ErrorCode.AUTHENTICATION,
    '',
    kind,
    false,
    CREDENTIAL_VALIDATION_REQUEST_ID,
  )
}

function normalizeCredentials(
  accessKeyIdValue: unknown,
  secretAccessKeyValue: unknown,
): NormalizedCredentials {
  if (
    typeof accessKeyIdValue !== 'string' ||
    typeof secretAccessKeyValue !== 'string'
  ) {
    return credentialError('missing_credentials')
  }

  const accessKeyId = accessKeyIdValue.trim()
  const secretAccessKey = secretAccessKeyValue.trim()
  if (accessKeyId === '' || secretAccessKey === '') {
    return credentialError('missing_credentials')
  }
  if (
    accessKeyId.length > MAX_PROTOCOL_NAME_LENGTH ||
    !ACCESS_KEY_ID_PATTERN.test(accessKeyId)
  ) {
    return credentialError('invalid_access_key_id')
  }
  if (
    secretAccessKey.length > MAX_PROTOCOL_NAME_LENGTH ||
    !CANONICAL_BASE64_PATTERN.test(secretAccessKey)
  ) {
    return credentialError('malformed_secret_access_key')
  }

  const decodedSecretAccessKey = Buffer.from(secretAccessKey, 'base64')
  if (
    decodedSecretAccessKey.length === 0 ||
    decodedSecretAccessKey.toString('base64') !== secretAccessKey
  ) {
    decodedSecretAccessKey.fill(0)
    return credentialError('malformed_secret_access_key')
  }
  decodedSecretAccessKey.fill(0)
  return { accessKeyId, secretAccessKey }
}

export class Locker implements ILockerSecret {
  #accessKeyId: string
  #secretAccessKey: string
  #headers?: Record<string, string>
  readonly #logger: Logger
  readonly #executor: ProtocolExecutor

  apiBase: string
  unsafe?: boolean
  cacheOptions?: CacheOptions

  constructor(options: LockerOptions) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Locker options are required')
    }
    const credentials = normalizeCredentials(
      options.accessKeyId,
      options.secretAccessKey,
    )
    this.#accessKeyId = credentials.accessKeyId
    this.#secretAccessKey = credentials.secretAccessKey
    this.apiBase =
      options.apiBase === undefined || options.apiBase === ''
        ? DEFAULT_BASE_API
        : requireString(options.apiBase, 'apiBase', MAX_API_BASE_LENGTH)
    this.headers = options.headers
    if (options.unsafe !== undefined && typeof options.unsafe !== 'boolean') {
      throw new TypeError('unsafe must be a boolean')
    }
    this.unsafe = options.unsafe
    this.cacheOptions = validateCacheOptions(options.cacheOptions)
    this.#logger = new Logger(options.logLevel ?? DEFAULT_LOG_LEVEL)
    if (
      options.executor !== undefined &&
      (typeof options.executor.execute !== 'function' ||
        typeof options.executor.executeSync !== 'function')
    ) {
      throw new TypeError('executor must implement the protocol executor API')
    }
    this.#executor =
      options.executor ??
      new BinaryExecutor(this.#logger, {
        cliPath: options.cliPath,
        maxBufferBytes: options.maxBufferBytes,
        timeoutMs: options.timeoutMs,
      })
  }

  static fromEnv(
    options: Omit<LockerOptions, 'accessKeyId' | 'secretAccessKey'> & {
      env?: EnvironmentSource
    } = {},
  ): Locker {
    const { env = process.env, ...lockerOptions } = options
    return new Locker({
      ...lockerOptions,
      apiBase: lockerOptions.apiBase ?? env.LOCKER_API_BASE,
      cliPath:
        lockerOptions.cliPath || env.LOCKER_CLI_PATH?.trim() || undefined,
      accessKeyId:
        firstEnvironmentValue(env, 'LOCKER_ACCESS_KEY_ID', 'ACCESS_KEY_ID') ??
        '',
      secretAccessKey:
        firstEnvironmentValue(
          env,
          'LOCKER_SECRET_ACCESS_KEY',
          'SECRET_ACCESS_KEY',
          'LOCKER_ACCESS_KEY_SECRET',
          'ACCESS_KEY_SECRET',
        ) ?? '',
    })
  }

  get accessKeyId(): string {
    return this.#accessKeyId
  }

  set accessKeyId(value: string) {
    const credentials = normalizeCredentials(value, this.#secretAccessKey)
    this.#accessKeyId = credentials.accessKeyId
  }

  get secretAccessKey(): string {
    return this.#secretAccessKey
  }

  set secretAccessKey(value: string) {
    const credentials = normalizeCredentials(this.#accessKeyId, value)
    this.#secretAccessKey = credentials.secretAccessKey
  }

  get headers(): Record<string, string> | undefined {
    return this.#headers ? { ...this.#headers } : undefined
  }

  set headers(value: Record<string, string> | undefined) {
    this.#headers = validateHeaders(value)
  }

  toJSON(): { apiBase: string; unsafe: boolean } {
    return {
      apiBase: this.apiBase,
      unsafe: this.unsafe ?? false,
    }
  }

  async export(
    params: {
      outputFile?: string
      format?: ExportFormat
      env?: string
      config?: CacheOptions
    } = {},
  ): Promise<void> {
    const format = params.format ?? 'txt'
    if (format !== 'txt' && format !== 'json' && format !== 'env') {
      throw new TypeError(`Unsupported export format: ${String(format)}`)
    }
    const filename =
      params.outputFile ??
      `output${params.env ? `.${params.env}` : ''}.${format}`
    const secrets = await this.list(params.env, params.config)
    await writePrivateFileAtomically(filename, formatSecrets(secrets, format))
  }

  async list(env?: string, config?: CacheOptions): Promise<Secret[]> {
    const data = await this.execute<unknown>(
      'secret.list',
      this.optionalField('environment', optionalEnvironment(env)),
      config,
    )
    return Converter.toSecrets(data)
  }

  listSync(env?: string, config?: CacheOptions): Secret[] {
    const data = this.executeSync<unknown>(
      'secret.list',
      this.optionalField('environment', optionalEnvironment(env)),
      config,
    )
    return Converter.toSecrets(data)
  }

  async listPage(
    page: PageRequest = {},
    env?: string,
    config?: CacheOptions,
  ): Promise<ISecretPage> {
    const data = await this.execute<unknown>(
      'secret.list_page',
      {
        ...pageParams(page),
        ...this.optionalField('environment', optionalEnvironment(env)),
      },
      config,
    )
    return Converter.toSecretPage(data)
  }

  listPageSync(
    page: PageRequest = {},
    env?: string,
    config?: CacheOptions,
  ): ISecretPage {
    const data = this.executeSync<unknown>(
      'secret.list_page',
      {
        ...pageParams(page),
        ...this.optionalField('environment', optionalEnvironment(env)),
      },
      config,
    )
    return Converter.toSecretPage(data)
  }

  async get(
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions,
  ): Promise<string | undefined> {
    try {
      return await this.getRequired(key, env, config)
    } catch (error) {
      if (isLockerNotFoundError(error)) {
        return defaultValue
      }
      throw error
    }
  }

  getSync(
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions,
  ): string | undefined {
    try {
      return this.getRequiredSync(key, env, config)
    } catch (error) {
      if (isLockerNotFoundError(error)) {
        return defaultValue
      }
      throw error
    }
  }

  async getRequired(
    key: string,
    env?: string,
    config?: CacheOptions,
  ): Promise<string> {
    return (await this.retrieve(key, env, config)).value
  }

  getRequiredSync(key: string, env?: string, config?: CacheOptions): string {
    return this.retrieveSync(key, env, config).value
  }

  async retrieve(
    key: string,
    env?: string,
    config?: CacheOptions,
  ): Promise<Secret> {
    const data = await this.execute<unknown>(
      'secret.get',
      {
        key: requireString(key, 'key'),
        ...this.optionalField('environment', optionalEnvironment(env)),
      },
      config,
    )
    return Converter.toSecret(data)
  }

  retrieveSync(key: string, env?: string, config?: CacheOptions): Secret {
    const data = this.executeSync<unknown>(
      'secret.get',
      {
        key: requireString(key, 'key'),
        ...this.optionalField('environment', optionalEnvironment(env)),
      },
      config,
    )
    return Converter.toSecret(data)
  }

  async create(
    data: {
      key: string
      value: string
      environmentName?: string
      description?: string
    },
    config?: CacheOptions,
  ): Promise<Secret> {
    if (typeof data?.value !== 'string') {
      throw new TypeError('value must be a string')
    }
    const result = await this.execute<unknown>(
      'secret.create',
      {
        key: requireString(data.key, 'key'),
        value: data.value,
        ...this.optionalField(
          'environment',
          optionalEnvironment(data.environmentName),
        ),
        ...this.optionalField(
          'description',
          optionalStringValue(data.description, 'description'),
        ),
      },
      config,
    )
    return Converter.toSecret(result)
  }

  async modify(
    key: string,
    env: string,
    data: {
      value?: string
      newKey?: string
      environmentName?: string | null
      description?: string
    },
    config?: CacheOptions,
  ): Promise<Secret> {
    if (!data || typeof data !== 'object') {
      throw new TypeError('changes are required')
    }
    const changes: Record<string, unknown> = {}
    if (data.newKey !== undefined) {
      changes.key = requireString(data.newKey, 'newKey')
    }
    if (data.value !== undefined) {
      if (typeof data.value !== 'string') {
        throw new TypeError('value must be a string')
      }
      changes.value = data.value
    }
    if (data.environmentName !== undefined) {
      changes.environment =
        data.environmentName === null || data.environmentName === ''
          ? null
          : requireString(data.environmentName, 'environmentName')
    }
    if (data.description !== undefined) {
      changes.description = requireStringValue(data.description, 'description')
    }
    if (Object.keys(changes).length === 0) {
      throw new TypeError('changes must contain at least one field')
    }

    const result = await this.execute<unknown>(
      'secret.update',
      {
        key: requireString(key, 'key'),
        ...this.optionalField('environment', optionalEnvironment(env)),
        changes,
      },
      config,
    )
    return Converter.toSecret(result)
  }

  async listEnvironments(config?: CacheOptions): Promise<Environment[]> {
    const data = await this.execute<unknown>('environment.list', {}, config)
    return Converter.toEnvironments(data)
  }

  listEnvironmentsSync(config?: CacheOptions): Environment[] {
    const data = this.executeSync<unknown>('environment.list', {}, config)
    return Converter.toEnvironments(data)
  }

  async listEnvironmentsPage(
    page: PageRequest = {},
    config?: CacheOptions,
  ): Promise<IEnvironmentPage> {
    const data = await this.execute<unknown>(
      'environment.list_page',
      pageParams(page),
      config,
    )
    return Converter.toEnvironmentPage(data)
  }

  listEnvironmentsPageSync(
    page: PageRequest = {},
    config?: CacheOptions,
  ): IEnvironmentPage {
    const data = this.executeSync<unknown>(
      'environment.list_page',
      pageParams(page),
      config,
    )
    return Converter.toEnvironmentPage(data)
  }

  async getEnvironment(
    name: string,
    config?: CacheOptions,
  ): Promise<Environment> {
    const data = await this.execute<unknown>(
      'environment.get',
      { name: requireString(name, 'name') },
      config,
    )
    return Converter.toEnvironment(data)
  }

  getEnvironmentSync(name: string, config?: CacheOptions): Environment {
    const data = this.executeSync<unknown>(
      'environment.get',
      { name: requireString(name, 'name') },
      config,
    )
    return Converter.toEnvironment(data)
  }

  async createEnvironment(
    data: {
      name: string
      externalUrl?: string
      description?: string
    },
    config?: CacheOptions,
  ): Promise<Environment> {
    const result = await this.execute<unknown>(
      'environment.create',
      {
        name: requireString(data?.name, 'name'),
        ...this.optionalField(
          'external_url',
          optionalStringValue(data.externalUrl, 'externalUrl'),
        ),
        ...this.optionalField(
          'description',
          optionalStringValue(data.description, 'description'),
        ),
      },
      config,
    )
    return Converter.toEnvironment(result)
  }

  async modifyEnvironment(
    name: string,
    data: {
      newName?: string
      externalUrl?: string
      description?: string
    },
    config?: CacheOptions,
  ): Promise<Environment> {
    if (!data || typeof data !== 'object') {
      throw new TypeError('changes are required')
    }
    const changes: Record<string, unknown> = {}
    if (data.newName !== undefined) {
      changes.name = requireString(data.newName, 'newName')
    }
    if (data.externalUrl !== undefined) {
      changes.external_url = requireStringValue(data.externalUrl, 'externalUrl')
    }
    if (data.description !== undefined) {
      changes.description = requireStringValue(data.description, 'description')
    }
    if (Object.keys(changes).length === 0) {
      throw new TypeError('changes must contain at least one field')
    }

    const result = await this.execute<unknown>(
      'environment.update',
      {
        name: requireString(name, 'name'),
        changes,
      },
      config,
    )
    return Converter.toEnvironment(result)
  }

  async import(source: string): Promise<void> {
    const contents = await readUTF8FileBounded(source, MAX_IMPORT_BYTES)
    const imported = parseImport(contents)
    const resolvedEnvironments = new Set<string>()

    for (const item of imported) {
      if (
        item.environment !== undefined &&
        !resolvedEnvironments.has(item.environment)
      ) {
        try {
          await this.getEnvironment(item.environment)
        } catch (error) {
          if (!isLockerNotFoundError(error)) {
            throw error
          }
          await this.createEnvironment({ name: item.environment })
        }
        resolvedEnvironments.add(item.environment)
      }
      await this.create({
        key: item.key,
        value: item.value,
        environmentName: item.environment,
      })
    }
  }

  private context(config?: CacheOptions): VaultContext {
    const defaults = validateCacheOptions(this.cacheOptions)
    const perCall = validateCacheOptions(config)
    if (
      typeof this.apiBase !== 'string' ||
      this.apiBase.length > MAX_API_BASE_LENGTH
    ) {
      throw new TypeError(
        `apiBase must be a string of at most ${MAX_API_BASE_LENGTH} characters`,
      )
    }
    if (this.unsafe !== undefined && typeof this.unsafe !== 'boolean') {
      throw new TypeError('unsafe must be a boolean')
    }
    return {
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      apiBase: this.apiBase,
      headers: this.#headers ? { ...this.#headers } : undefined,
      unsafe: this.unsafe,
      fetch: perCall?.fetch ?? defaults?.fetch,
      restTime: perCall?.restTime ?? defaults?.restTime,
    }
  }

  private executionOptions(config?: CacheOptions) {
    const validated = validateCacheOptions(config)
    return {
      signal: validated?.signal,
      timeoutMs: validated?.timeoutMs,
    }
  }

  private async execute<T>(
    method: Parameters<ProtocolExecutor['execute']>[0],
    params: Readonly<Record<string, unknown>>,
    config?: CacheOptions,
  ): Promise<T> {
    return await this.#executor.execute<T>(
      method,
      this.context(config),
      params,
      this.executionOptions(config),
    )
  }

  private executeSync<T>(
    method: Parameters<ProtocolExecutor['executeSync']>[0],
    params: Readonly<Record<string, unknown>>,
    config?: CacheOptions,
  ): T {
    return this.#executor.executeSync<T>(
      method,
      this.context(config),
      params,
      this.executionOptions(config),
    )
  }

  private optionalField(name: string, value: unknown): Record<string, unknown> {
    return value === undefined ? {} : { [name]: value }
  }
}
