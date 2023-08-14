import { ILockerSecret } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import { Action, CommandParams, Executor, Target } from './abstraction/executor'
import { executor } from './executors'
import { Converter } from './utils/converter'

class Locker implements ILockerSecret {
  baseApi: string
  accessKey: string
  executor: Executor

  constructor(executor: Executor) {
    this.accessKey = ''
    this.baseApi = 'https://secrets-core.locker.io'
    this.executor = executor
  }

  async list() {
    const res = await this._execute({
      target: Target.SECRET,
      action: Action.LIST,
    })
    return Converter.toSecrets(res)
  }

  listSync() {
    const res = this._executeSync({
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
      if (!(error instanceof EmptyOutputError)) {
        console.error(error)
      }
      return defaultValue
    }
  }

  getSync(key: string, env?: string, defaultValue?: any) {
    try {
      const res = this._executeSync({
        target: Target.SECRET,
        action: Action.GET,
        id: key,
        env,
      })
      return Converter.toSecret(res).value
    } catch (error) {
      if (!(error instanceof EmptyOutputError)) {
        console.error(error)
      }
      return defaultValue
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
      data: { key, ...data },
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

  listEnvironmentsSync() {
    const res = this._executeSync({
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

  getEnvironmentSync(name: string) {
    const res = this._executeSync({
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
      data: { name, ...data },
    })
    return Converter.toEnvironment(res)
  }

  private async _execute(
    params: Omit<Omit<CommandParams, 'accessKey'>, 'apiBase'>
  ) {
    try {
      return await this.executor.runCommand({
        ...params,
        accessKey: this.accessKey,
        apiBase: this.baseApi,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }

  private _executeSync(
    params: Omit<Omit<CommandParams, 'accessKey'>, 'apiBase'>
  ) {
    try {
      return this.executor.runCommandSync({
        ...params,
        accessKey: this.accessKey,
        apiBase: this.baseApi,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}

export const locker = new Locker(executor)
