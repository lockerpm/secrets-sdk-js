import { ILockerSecret, LogLevel } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import { Action, CommandParams, Executor, Target } from './abstraction/executor'
import { BinaryExecutor } from './executors/binary'
import { Converter } from './utils/converter'
import { Logger } from './utils/logger'

const DEFAULT_BASE_API = 'https://api.locker.io/locker_secrets'
const DEFAULT_LOG_LEVEL = LogLevel.ERROR

export class Locker implements ILockerSecret {
  apiBase: string
  accessKeyId: string
  accessKeySecret: string
  headers?: { [key: string]: string }
  unsafe?: boolean | undefined

  private logger: Logger
  private executor: Executor

  constructor(options: {
    accessKeyId: string
    accessKeySecret: string
    apiBase?: string
    headers?: { [key: string]: string }
    unsafe?: boolean
    logLevel?: LogLevel
  }) {
    const { accessKeyId, accessKeySecret, apiBase, headers, unsafe, logLevel } =
      options
    this.accessKeyId = accessKeyId
    this.accessKeySecret = accessKeySecret
    this.apiBase = apiBase || DEFAULT_BASE_API
    this.headers = headers
    this.logger = new Logger(logLevel || DEFAULT_LOG_LEVEL)
    this.executor = new BinaryExecutor(this.logger)
    this.unsafe = unsafe
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

  async get(key: string, env?: string, defaultValue?: string) {
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

  getSync(key: string, env?: string, defaultValue?: string) {
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
      data: { key, ...data, environmentName: data.environmentName || null },
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
        unsafe: this.unsafe,
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
        unsafe: this.unsafe,
      })
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}
