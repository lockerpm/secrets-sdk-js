export interface ILockerSecret {
  baseApi: string
  accessKey: string
  list: () => Promise<ISecret[]>
  get: (
    key: string,
    env?: string,
    defaultValue?: any
  ) => Promise<string | undefined>
  create: (key: string, value: string) => Promise<ISecret>
  modify: (key: string, value: string) => Promise<ISecret>
  listEnvironments: () => Promise<IEnvironment[]>
  getEnvironment: (name: string) => Promise<IEnvironment | undefined>
  createEnvironment: (name: string) => Promise<IEnvironment>
  modifyEnvironment: (name: string) => Promise<IEnvironment>
}

export interface ISecret {
  key: string
  value: string
  description?: string
  environmentId?: string
  environmentName?: string
}

export interface IEnvironment {
  name: string
  externalUrl?: string
  description?: string
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
    if (typeof key !== typeof this._raw[key]) {
      throw Error(
        `Invalid value for ${key}. Expected value but got ${this._raw[key]}`
      )
    }
    return this._raw[key]
  }
}
