import type {
  CacheOptions,
  ExportFormat,
  ProtocolExecutor,
} from './executor.js'

export * from './errors.js'
export * from './executor.js'

export type LockerOptions = {
  accessKeyId: string
  secretAccessKey: string
  apiBase?: string
  headers?: Record<string, string>
  unsafe?: boolean
  logLevel?: LogLevel
  cacheOptions?: CacheOptions
  /**
   * Explicit absolute path to a trusted regular, non-link Locker CLI file.
   * Bare and relative paths are rejected; the SDK never searches PATH.
   */
  cliPath?: string
  timeoutMs?: number
  maxBufferBytes?: number
  /**
   * Dependency-injection seam for tests and advanced embedding.
   */
  executor?: ProtocolExecutor
}

export type PageRequest = {
  readonly pageSize?: number
  readonly cursor?: string
}

export interface ISecretPage {
  readonly object: 'secret_page'
  readonly items: readonly ISecret[]
  readonly nextCursor: string | null
}

export interface IEnvironmentPage {
  readonly object: 'environment_page'
  readonly items: readonly IEnvironment[]
  readonly nextCursor: string | null
}

export interface ILockerSecret {
  apiBase: string
  accessKeyId: string
  secretAccessKey: string
  headers?: Record<string, string>
  unsafe?: boolean
  cacheOptions?: CacheOptions

  export: (params?: {
    outputFile?: string
    format?: ExportFormat
    env?: string
    config?: CacheOptions
  }) => Promise<void>

  list: (env?: string, config?: CacheOptions) => Promise<ISecret[]>
  listSync: (env?: string, config?: CacheOptions) => ISecret[]
  listPage: (
    page?: PageRequest,
    env?: string,
    config?: CacheOptions,
  ) => Promise<ISecretPage>
  listPageSync: (
    page?: PageRequest,
    env?: string,
    config?: CacheOptions,
  ) => ISecretPage

  /**
   * Return a default only when Locker reports NOT_FOUND. All other failures
   * are propagated.
   */
  get: (
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions,
  ) => Promise<string | undefined>

  getSync: (
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions,
  ) => string | undefined

  getRequired: (
    key: string,
    env?: string,
    config?: CacheOptions,
  ) => Promise<string>

  getRequiredSync: (key: string, env?: string, config?: CacheOptions) => string

  retrieve: (
    key: string,
    env?: string,
    config?: CacheOptions,
  ) => Promise<ISecret>

  retrieveSync: (key: string, env?: string, config?: CacheOptions) => ISecret

  create: (
    data: {
      key: string
      value: string
      environmentName?: string
      description?: string
    },
    config?: CacheOptions,
  ) => Promise<ISecret>

  modify: (
    key: string,
    env: string,
    data: {
      value?: string
      newKey?: string
      environmentName?: string | null
      description?: string
    },
    config?: CacheOptions,
  ) => Promise<ISecret>

  listEnvironments: (config?: CacheOptions) => Promise<IEnvironment[]>
  listEnvironmentsSync: (config?: CacheOptions) => IEnvironment[]
  listEnvironmentsPage: (
    page?: PageRequest,
    config?: CacheOptions,
  ) => Promise<IEnvironmentPage>
  listEnvironmentsPageSync: (
    page?: PageRequest,
    config?: CacheOptions,
  ) => IEnvironmentPage

  getEnvironment: (name: string, config?: CacheOptions) => Promise<IEnvironment>

  getEnvironmentSync: (name: string, config?: CacheOptions) => IEnvironment

  createEnvironment: (
    data: {
      name: string
      externalUrl?: string
      description?: string
    },
    config?: CacheOptions,
  ) => Promise<IEnvironment>

  modifyEnvironment: (
    name: string,
    data: {
      newName?: string
      externalUrl?: string
      description?: string
    },
    config?: CacheOptions,
  ) => Promise<IEnvironment>

  /**
   * Import dotenv/INI-style assignments. Vault mutations use protocol v1.
   */
  import: (source: string) => Promise<void>
}

export interface ISecret {
  readonly object?: string
  readonly id?: string
  readonly creationDate?: number
  readonly revisionDate?: number
  readonly updatedDate?: number | null
  readonly deletedDate?: number | null
  readonly lastUseDate?: number | null
  readonly projectId?: number
  readonly environmentId?: string | null
  environmentName: string | null
  key: string
  value: string
  description: string
}

export interface IEnvironment {
  readonly object?: string
  readonly id?: string
  name: string
  externalUrl: string
  description: string
  readonly creationDate?: number
  readonly revisionDate?: number
  readonly updatedDate?: number | null
  readonly projectId?: number
}

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  DEBUG = 2,
}

export type SecretData = {
  object: string
  id: string
  creation_date: number
  revision_date: number
  updated_date: number | null
  deleted_date: number | null
  last_use_date: number | null
  project_id: number
  environment_id: string | null
  environment_name: string | null
  key: string
  value: string
  description: string
  [key: string]: unknown
}

export type EnvironmentData = {
  object: string
  id: string
  name: string
  external_url: string
  description: string
  creation_date: number
  revision_date: number
  updated_date: number | null
  project_id: number
  [key: string]: unknown
}

export class LockerObj<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  _raw: T

  constructor(obj: T) {
    this._raw = { ...obj }
  }

  toJSON(): T {
    return { ...this._raw }
  }

  protected getValueOrDefault(key: string, defaultValue?: any): any {
    const value = this._raw[key]
    return value === undefined ? defaultValue : value
  }
}
