import { ILockerSecret } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import { Environment, Secret } from './resources'
import { Action, CommandParams, Target, runCommand } from './utils/command'
import { Converter } from './utils/converter'

class Locker implements ILockerSecret {
  baseApi: string
  accessKey: string

  constructor() {
    this.accessKey = ''
    this.baseApi = 'https://secrets-core.locker.io'
  }

  async list() {
    const res = await this._execute({
      target: Target.SECRET,
      action: Action.LIST,
    })
    return Converter.toSecrets(res)
  }

  async get(key: string, env?: string, defaultValue?: any) {
    try {
      const res = await this._execute({
        target: Target.SECRET,
        action: Action.GET,
        id: key,
        env,
      })
      return Converter.toSecret(res).value
    } catch (error) {
      if (defaultValue !== undefined) {
        return defaultValue
      }
      if (error instanceof EmptyOutputError) {
        return undefined
      }
      throw error
    }
  }

  async create(key: string, value: string) {
    return Promise.resolve(new Secret({}))
  }

  async modify(key: string, value: string) {
    return Promise.resolve(new Secret({}))
  }

  async listEnvironments() {
    const res = await this._execute({
      target: Target.ENVIRONMENT,
      action: Action.LIST,
    })
    return Converter.toEnvironments(res)
  }

  async getEnvironment(name: string) {
    const res = await this._execute({
      target: Target.ENVIRONMENT,
      action: Action.GET,
      id: name,
    })
    return Converter.toEnvironment(res)
  }

  async createEnvironment(name: string): Promise<Environment> {
    return Promise.resolve(new Environment({}))
  }

  async modifyEnvironment(name: string): Promise<Environment> {
    return Promise.resolve(new Environment({}))
  }

  private _execute(params: Omit<Omit<CommandParams, 'accessKey'>, 'apiBase'>) {
    return runCommand({
      ...params,
      accessKey: this.accessKey,
      apiBase: this.baseApi,
    })
  }
}

export const locker = new Locker()
