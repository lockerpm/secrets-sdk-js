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

  async create(data: {
    key: string
    value: string
    environmentName?: string
    description?: string
  }) {
    const res = await this._execute({
      target: Target.SECRET,
      action: Action.CREATE,
      data,
    })
    return Converter.toSecret(res)
  }

  async modify(
    key: string,
    data: {
      value: string
      environmentName?: string
      description?: string
    }
  ) {
    const res = await this._execute({
      target: Target.SECRET,
      action: Action.UPDATE,
      id: key,
      data,
    })
    return Converter.toSecret(res)
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

  async createEnvironment(data: {
    name: string
    externalUrl?: string
    description?: string
  }) {
    const res = await this._execute({
      target: Target.ENVIRONMENT,
      action: Action.CREATE,
      data,
    })
    return Converter.toEnvironment(res)
  }

  async modifyEnvironment(
    name: string,
    data: { externalUrl?: string; description?: string }
  ) {
    const res = await this._execute({
      target: Target.ENVIRONMENT,
      action: Action.UPDATE,
      id: name,
      data,
    })
    return Converter.toEnvironment(res)
  }

  private async _execute(
    params: Omit<Omit<CommandParams, 'accessKey'>, 'apiBase'>
  ) {
    try {
      return await runCommand({
        ...params,
        accessKey: this.accessKey,
        apiBase: this.baseApi,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}

export const locker = new Locker()
