import { ILockerSecret, LogLevel } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import { Action, CommandParams, Executor, Target } from './abstraction/executor'
import { BinaryExecutor } from './executors/binary'
import { Converter } from './utils/converter'
import { Logger } from './utils/logger'

export class Locker implements ILockerSecret {
  apiBase: string
  accessKeyId: string
  accessKeySecret: string
  executor: Executor
  headers?: { [key: string]: string }
  logger: Logger

  constructor(options: {
    accessKeyId: string
    accessKeySecret: string
    apiBase?: string
    headers?: { [key: string]: string }
    logLevel?: LogLevel
  }) {
    const { accessKeyId, accessKeySecret, apiBase, headers, logLevel } = options
    this.accessKeyId = accessKeyId
    this.accessKeySecret = accessKeySecret
    this.apiBase = apiBase || 'https://secrets-core.locker.io'
    this.headers = headers
    this.logger = new Logger(logLevel || LogLevel.ERROR)
    this.executor = new BinaryExecutor(this.logger)
  }

  // ---------------- SECRET ----------------

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
        name: key,
        env,
      })
      return Converter.toSecret(res).value
    } catch (error) {
      if (!(error instanceof EmptyOutputError)) {
        this.logger.error(error)
      }
      return defaultValue
    }
  }

  getSync(key: string, env?: string, defaultValue?: any) {
    try {
      const res = this._executeSync({
        target: Target.SECRET,
        action: Action.GET,
        name: key,
        env,
      })
      return Converter.toSecret(res).value
    } catch (error) {
      if (!(error instanceof EmptyOutputError)) {
        this.logger.error(error)
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
    env: string,
    data: {
      value: string
      environmentName?: string
      description?: string
    }
  ) {
    const res = await this._execute({
      target: Target.SECRET,
      action: Action.UPDATE,
      name: key,
      env,
      data: { key, ...data },
    })
    return Converter.toSecret(res)
  }

  // ---------------- ENV ----------------

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
      name,
    })
    return Converter.toEnvironment(res)
  }

  getEnvironmentSync(name: string) {
    const res = this._executeSync({
      target: Target.ENVIRONMENT,
      action: Action.GET,
      name,
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
      name,
      data: { name, ...data },
    })
    return Converter.toEnvironment(res)
  }

  // ----------------- PRIVATE METHDOS -----------------

  private async _execute(
    params: Omit<
      Omit<Omit<CommandParams, 'accessKeyId'>, 'accessKeySecret'>,
      'apiBase'
    >
  ) {
    try {
      return await this.executor.runCommand({
        ...params,
        accessKeyId: this.accessKeyId,
        accessKeySecret: this.accessKeySecret,
        apiBase: this.apiBase,
        headers: this.headers,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }

  private _executeSync(
    params: Omit<
      Omit<Omit<CommandParams, 'accessKeyId'>, 'accessKeySecret'>,
      'apiBase'
    >
  ) {
    try {
      return this.executor.runCommandSync({
        ...params,
        accessKeyId: this.accessKeyId,
        accessKeySecret: this.accessKeySecret,
        apiBase: this.apiBase,
        headers: this.headers,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}
