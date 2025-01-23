import { ExportFormat } from './executor'

export interface ILockerSecret {
  apiBase: string
  accessKeyId: string
  secretAccessKey: string
  headers?: { [key: string]: string }
  unsafe?: boolean
  cacheOptions?: CacheOptions

  /**
   * Export secrets to file
   * @param params outputFile must be either filename, or an absolute path
   * @returns
   */
  export: (params: {
    outputFile?: string
    format?: ExportFormat
    env?: string
    config?: CacheOptions
  }) => Promise<void>

  /**
   * List all secrets
   * @param env
   * @param config
   * @returns
   */
  list: (env?: string, config?: CacheOptions) => Promise<ISecret[]>

  /**
   * List all secrets, but synchronously
   * @param env
   * @param config
   * @returns
   */
  listSync: (env?: string, config?: CacheOptions) => ISecret[]

  /**
   * Get a secret value by key and environment name, optionally return a default value
   * @param key
   * @param env
   * @param defaultValue
   * @param config
   * @returns
   */
  get: (
    key: string,
    env?: string,
    defaultValue?: any,
    config?: CacheOptions
  ) => Promise<string | undefined>

  /**
   * Get a secret value synchronously by key and environment name, optionally return a default value
   * @param key
   * @param env
   * @param defaultValue
   * @param config
   * @returns
   */
  getSync: (
    key: string,
    env?: string,
    defaultValue?: any,
    config?: CacheOptions
  ) => string | undefined

  /**
   * Get a secret object by key and environment name
   * @param key
   * @param env
   * @param config
   * @returns
   */
  retrieve: (
    key: string,
    env?: string,
    config?: CacheOptions
  ) => Promise<ISecret>

  /**
   * Get a secret object synchronously by key and environment name
   * @param key
   * @param env
   * @param config
   * @returns
   */
  retrieveSync: (key: string, env?: string, config?: CacheOptions) => ISecret

  /**
   * Create a secret
   * @param data
   * @param config
   * @returns
   */
  create: (
    data: {
      key: string
      value: string
      environmentName?: string
      description?: string
    },
    config?: CacheOptions
  ) => Promise<ISecret>

  /**
   * Update a secret
   * @param key
   * @param data
   * @param config
   * @returns
   */
  modify: (
    key: string,
    env: string,
    data: {
      value: string
      environmentName?: string
      description?: string
    },
    config?: CacheOptions
  ) => Promise<ISecret>

  /**
   * List all environments
   * @param config
   * @returns
   */
  listEnvironments: (config?: CacheOptions) => Promise<IEnvironment[]>

  /**
   * List all environments but synchronously
   * @param config
   * @returns
   */
  listEnvironmentsSync: (config?: CacheOptions) => IEnvironment[]

  /**
   * Get an environment
   * @param name
   * @param config
   * @returns
   */
  getEnvironment: (
    name: string,
    config?: CacheOptions
  ) => Promise<IEnvironment | undefined>

  /**
   * Get an environment but synchronously
   * @param name
   * @param config
   * @returns
   */
  getEnvironmentSync: (
    name: string,
    config?: CacheOptions
  ) => IEnvironment | undefined

  /**
   * Create an environment
   * @param data
   * @param config
   * @returns
   */
  createEnvironment: (
    data: {
      name: string
      externalUrl: string
      description?: string
    },
    config?: CacheOptions
  ) => Promise<IEnvironment>

  /**
   * Update an environment
   * @param name
   * @param data
   * @param config
   * @returns
   */
  modifyEnvironment: (
    name: string,
    data: { externalUrl: string; description?: string },
    config?: CacheOptions
  ) => Promise<IEnvironment>

  /**
   * Read all secrets from source file and save to Locker Secrets, supporing .env and .ini files
   * @param source absolute path to file
   * @returns list of detected secrets
   */
  import: (source: string) => Promise<void>
}

export interface ISecret {
  key: string
  value: string
  description: string
  environmentName: string | null
}

export interface IEnvironment {
  name: string
  externalUrl: string
  description: string
}

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  DEBUG = 2,
}

export type CacheOptions = {
  fetch?: boolean
  restTime?: number
}

export class LockerObj {
  _raw: { [key: string]: any }
  constructor(obj: { [key: string]: any }) {
    this._raw = obj
  }
  protected getValueOrDefault(key: string, defaultValue?: any) {
    if (this._raw[key] === undefined && defaultValue !== undefined) {
      return defaultValue
    }
    // TODO: apply type check here
    return this._raw[key]
  }
}
