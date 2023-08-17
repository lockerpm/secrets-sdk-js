export interface ILockerSecret {
  baseApi: string
  accessKey: string
  headers?: { [key: string]: string }
  list: () => Promise<ISecret[]>
  listSync: () => ISecret[]
  get: (
    key: string,
    env?: string,
    defaultValue?: any
  ) => Promise<string | undefined>
  getSync: (key: string, env?: string, defaultValue?: any) => string | undefined
  create: (data: {
    key: string
    value: string
    environmentName?: string
    description?: string
  }) => Promise<ISecret>
  modify: (
    key: string,
    data: {
      value: string
      environmentName?: string
      description?: string
    }
  ) => Promise<ISecret>
  listEnvironments: () => Promise<IEnvironment[]>
  listEnvironmentsSync: () => IEnvironment[]
  getEnvironment: (name: string) => Promise<IEnvironment | undefined>
  getEnvironmentSync: (name: string) => IEnvironment | undefined
  createEnvironment: (data: {
    name: string
    externalUrl?: string
    description?: string
  }) => Promise<IEnvironment>
  modifyEnvironment: (
    name: string,
    data: { externalUrl?: string; description?: string }
  ) => Promise<IEnvironment>
}

export interface ISecret {
  key: string
  value: string
  description?: string
  environmentName?: string
}

export interface IEnvironment {
  name: string
  externalUrl?: string
  description?: string
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
    if (typeof key !== typeof this._raw[key]) {
      throw Error(
        `Invalid value for ${key}. Expected value but got ${this._raw[key]}`
      )
    }
    return this._raw[key]
  }
}
