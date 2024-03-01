export interface ILockerSecret {
  apiBase: string
  accessKeyId: string
  secretAccessKey: string
  headers?: { [key: string]: string }
  unsafe?: boolean

  /**
   * List all secrets
   * @returns
   */
  list: () => Promise<ISecret[]>

  /**
   * List all secrets, but synchronously
   * @returns
   */
  listSync: () => ISecret[]

  /**
   * Get a secret value by key and environment name, optionally return a default value
   * @param key
   * @param env
   * @param defaultValue
   * @returns
   */
  get: (
    key: string,
    env?: string | null,
    defaultValue?: any
  ) => Promise<string | undefined>

  /**
   * Get a secret value synchronously by key and environment name, optionally return a default value
   * @param key
   * @param env
   * @param defaultValue
   * @returns
   */
  getSync: (
    key: string,
    env?: string | null,
    defaultValue?: any
  ) => string | undefined

  /**
   * Get a secret object by key and environment name
   * @param key
   * @param env
   * @returns
   */
  retrieve: (key: string, env?: string | null) => Promise<ISecret>

  /**
   * Get a secret object synchronously by key and environment name
   * @param key
   * @param env
   * @returns
   */
  retrieveSync: (key: string, env?: string | null) => ISecret

  /**
   * Create a secret
   * @param data
   * @returns
   */
  create: (data: {
    key: string
    value: string
    environmentName?: string
    description?: string
  }) => Promise<ISecret>

  /**
   * Update a secret
   * @param key
   * @param data
   * @returns
   */
  modify: (
    key: string,
    env: string,
    data: {
      value: string
      environmentName?: string
      description?: string
    }
  ) => Promise<ISecret>

  /**
   * List all environments
   * @returns
   */
  listEnvironments: () => Promise<IEnvironment[]>

  /**
   * List all environments but synchronously
   * @returns
   */
  listEnvironmentsSync: () => IEnvironment[]

  /**
   * Get an environment
   * @param name
   * @returns
   */
  getEnvironment: (name: string) => Promise<IEnvironment | undefined>

  /**
   * Get an environment but synchronously
   * @param name
   * @returns
   */
  getEnvironmentSync: (name: string) => IEnvironment | undefined

  /**
   * Create an environment
   * @param data
   * @returns
   */
  createEnvironment: (data: {
    name: string
    externalUrl: string
    description?: string
  }) => Promise<IEnvironment>

  /**
   * Update an environment
   * @param name
   * @param data
   * @returns
   */
  modifyEnvironment: (
    name: string,
    data: { externalUrl: string; description?: string }
  ) => Promise<IEnvironment>
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
