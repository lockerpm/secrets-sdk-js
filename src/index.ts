import { ILockerSecret, LogLevel } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import {
  Action,
  CommandConfig,
  CommandData,
  Executor,
  Target,
} from './abstraction/executor'
import { BinaryExecutor } from './executors/binary'
import { Converter } from './utils/converter'
import { Logger } from './utils/logger'

const DEFAULT_BASE_API = 'https://api.locker.io/locker_secrets'
const DEFAULT_LOG_LEVEL = LogLevel.ERROR

export class Locker implements ILockerSecret {
  apiBase: string
  accessKeyId: string
  secretAccessKey: string
  headers?: { [key: string]: string }
  unsafe?: boolean | undefined

  private logger: Logger
  private executor: Executor

  constructor(options: {
    accessKeyId: string
    secretAccessKey: string
    apiBase?: string
    headers?: { [key: string]: string }
    unsafe?: boolean
    logLevel?: LogLevel
  }) {
    const { accessKeyId, secretAccessKey, apiBase, headers, unsafe, logLevel } =
      options
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.apiBase = apiBase || DEFAULT_BASE_API
    this.headers = headers
    this.logger = new Logger(logLevel || DEFAULT_LOG_LEVEL)
    this.executor = new BinaryExecutor(this.logger)
    this.unsafe = unsafe
  }

  // ---------------- SECRET ----------------

  async list() {
    const res = await this._execute<Target.SECRET, Action.LIST>(
      {
        target: Target.SECRET,
        action: Action.LIST,
      },
      undefined
    )
    return Converter.toSecrets(res)
  }

  listSync() {
    const res = this._executeSync<Target.SECRET, Action.LIST>(
      {
        target: Target.SECRET,
        action: Action.LIST,
      },
      undefined
    )
    return Converter.toSecrets(res)
  }

  async get(key: string, env?: string, defaultValue?: string) {
    try {
      const res = await this._execute<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
        },
        {
          key,
          environment: env,
        }
      )
      if (res.trim() === '[]') {
        throw new EmptyOutputError()
      }
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
      const res = this._executeSync<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
        },
        {
          key,
          environment: env,
        }
      )
      return Converter.toSecret(res).value
    } catch (error) {
      if (!(error instanceof EmptyOutputError)) {
        this.logger.error(error)
      }
      return defaultValue
    }
  }

  async retrieve(key: string, env?: string) {
    try {
      const res = await this._execute<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
        },
        {
          key,
          environment: env,
        }
      )
      if (res.trim() === '[]') {
        throw new EmptyOutputError()
      }
      return Converter.toSecret(res)
    } catch (error) {
      throw error
    }
  }

  retrieveSync(key: string, env?: string) {
    try {
      const res = this._executeSync<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
        },
        {
          key,
          environment: env,
        }
      )
      return Converter.toSecret(res)
    } catch (error) {
      throw error
    }
  }

  async create(data: {
    key: string
    value: string
    environmentName?: string
    description?: string
  }) {
    const res = await this._execute<Target.SECRET, Action.CREATE>(
      {
        target: Target.SECRET,
        action: Action.CREATE,
      },
      {
        key: data.key,
        value: data.value,
        environment: data.environmentName,
        description: data.description,
      }
    )
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
    const res = await this._execute<Target.SECRET, Action.UPDATE>(
      {
        target: Target.SECRET,
        action: Action.UPDATE,
      },
      {
        key,
        environment: env,
        newValue: data.value,
        newEnvironment: data.environmentName,
        newDescription: data.description,
      }
    )
    return Converter.toSecret(res)
  }

  // ---------------- ENV ----------------

  async listEnvironments() {
    const res = await this._execute<Target.ENVIRONMENT, Action.LIST>(
      {
        target: Target.ENVIRONMENT,
        action: Action.LIST,
      },
      undefined
    )
    return Converter.toEnvironments(res)
  }

  listEnvironmentsSync() {
    const res = this._executeSync<Target.ENVIRONMENT, Action.LIST>(
      {
        target: Target.ENVIRONMENT,
        action: Action.LIST,
      },
      undefined
    )
    return Converter.toEnvironments(res)
  }

  async getEnvironment(name: string) {
    const res = await this._execute<Target.ENVIRONMENT, Action.GET>(
      {
        target: Target.ENVIRONMENT,
        action: Action.GET,
      },
      {
        name,
      }
    )
    return Converter.toEnvironment(res)
  }

  getEnvironmentSync(name: string) {
    const res = this._executeSync<Target.ENVIRONMENT, Action.GET>(
      {
        target: Target.ENVIRONMENT,
        action: Action.GET,
      },
      {
        name,
      }
    )
    return Converter.toEnvironment(res)
  }

  async createEnvironment(data: {
    name: string
    externalUrl: string
    description?: string
  }) {
    const res = await this._execute<Target.ENVIRONMENT, Action.CREATE>(
      {
        target: Target.ENVIRONMENT,
        action: Action.CREATE,
      },
      {
        name: data.name,
        url: data.externalUrl,
        description: data.description,
      }
    )
    return Converter.toEnvironment(res)
  }

  async modifyEnvironment(
    name: string,
    data: { externalUrl: string; description?: string }
  ) {
    const res = await this._execute<Target.ENVIRONMENT, Action.UPDATE>(
      {
        target: Target.ENVIRONMENT,
        action: Action.UPDATE,
      },
      {
        name,
        newUrl: data.externalUrl,
        newDescription: data.description,
      }
    )
    return Converter.toEnvironment(res)
  }

  // ----------------- PRIVATE METHDOS -----------------

  private async _execute<T extends Target, A extends Action>(
    config: Omit<
      Omit<Omit<CommandConfig, 'accessKeyId'>, 'secretAccessKey'>,
      'apiBase'
    >,
    data: CommandData[T][A]
  ) {
    try {
      return await this.executor.runCommand(
        {
          ...config,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          apiBase: this.apiBase,
          headers: this.headers,
          unsafe: this.unsafe,
        },
        data
      )
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }

  private _executeSync<T extends Target, A extends Action>(
    config: Omit<
      Omit<Omit<CommandConfig, 'accessKeyId'>, 'secretAccessKey'>,
      'apiBase'
    >,
    data: CommandData[T][A]
  ) {
    try {
      return this.executor.runCommandSync(
        {
          ...config,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          apiBase: this.apiBase,
          headers: this.headers,
          unsafe: this.unsafe,
        },
        data
      )
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}
