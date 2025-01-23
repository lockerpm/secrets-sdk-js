import { CacheOptions, ILockerSecret, LogLevel } from './abstraction'
import { EmptyOutputError } from './abstraction/errors'
import {
  Action,
  CommandConfig,
  CommandData,
  Executor,
  ExportFormat,
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
  cacheOptions?: CacheOptions | undefined

  private logger: Logger
  private executor: Executor

  constructor(options: {
    accessKeyId: string
    secretAccessKey: string
    apiBase?: string
    headers?: { [key: string]: string }
    unsafe?: boolean
    logLevel?: LogLevel
    cacheOptions?: CacheOptions
  }) {
    const {
      accessKeyId,
      secretAccessKey,
      apiBase,
      headers,
      unsafe,
      logLevel,
      cacheOptions,
    } = options
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.apiBase = apiBase || DEFAULT_BASE_API
    this.headers = headers
    this.logger = new Logger(logLevel ?? DEFAULT_LOG_LEVEL)
    this.executor = new BinaryExecutor(this.logger)
    this.unsafe = unsafe
    this.cacheOptions = cacheOptions
  }

  // ---------------- SECRET ----------------

  async export(params: {
    outputFile?: string
    format?: ExportFormat
    env?: string
    config?: CacheOptions
  }) {
    const { config, env, outputFile, format } = params
    const filename =
      outputFile || `output${env ? '.' + env : ''}.${format || 'txt'}`
    await this._execute<Target.SECRET, Action.LIST>(
      {
        target: Target.SECRET,
        action: Action.LIST,
        fetch: config?.fetch,
        restTime: config?.restTime,
        output: filename,
        outputFormat: format,
      },
      {
        environment: env,
      }
    )
  }

  async list(env?: string, config?: CacheOptions) {
    const res = await this._execute<Target.SECRET, Action.LIST>(
      {
        target: Target.SECRET,
        action: Action.LIST,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      {
        environment: env,
      }
    )
    return Converter.toSecrets(res)
  }

  listSync(env?: string, config?: CacheOptions) {
    const res = this._executeSync<Target.SECRET, Action.LIST>(
      {
        target: Target.SECRET,
        action: Action.LIST,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      {
        environment: env,
      }
    )
    return Converter.toSecrets(res)
  }

  async get(
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions
  ) {
    try {
      const res = await this._execute<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
          fetch: config?.fetch,
          restTime: config?.restTime,
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

  getSync(
    key: string,
    env?: string,
    defaultValue?: string,
    config?: CacheOptions
  ) {
    try {
      const res = this._executeSync<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
          fetch: config?.fetch,
          restTime: config?.restTime,
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

  async retrieve(key: string, env?: string, config?: CacheOptions) {
    try {
      const res = await this._execute<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
          fetch: config?.fetch,
          restTime: config?.restTime,
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

  retrieveSync(key: string, env?: string, config?: CacheOptions) {
    try {
      const res = this._executeSync<Target.SECRET, Action.GET>(
        {
          target: Target.SECRET,
          action: Action.GET,
          fetch: config?.fetch,
          restTime: config?.restTime,
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

  async create(
    data: {
      key: string
      value: string
      environmentName?: string
      description?: string
    },
    config?: CacheOptions
  ) {
    const res = await this._execute<Target.SECRET, Action.CREATE>(
      {
        target: Target.SECRET,
        action: Action.CREATE,
        fetch: config?.fetch,
        restTime: config?.restTime,
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
    },
    config?: CacheOptions
  ) {
    const res = await this._execute<Target.SECRET, Action.UPDATE>(
      {
        target: Target.SECRET,
        action: Action.UPDATE,
        fetch: config?.fetch,
        restTime: config?.restTime,
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

  async import(source: string) {
    await this._execute<Target.SECRET, Action.IMPORT>(
      {
        target: Target.SECRET,
        action: Action.IMPORT,
      },
      {
        source,
      }
    )
  }

  // ---------------- ENV ----------------

  async listEnvironments(config?: CacheOptions) {
    const res = await this._execute<Target.ENVIRONMENT, Action.LIST>(
      {
        target: Target.ENVIRONMENT,
        action: Action.LIST,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      undefined
    )
    return Converter.toEnvironments(res)
  }

  listEnvironmentsSync(config?: CacheOptions) {
    const res = this._executeSync<Target.ENVIRONMENT, Action.LIST>(
      {
        target: Target.ENVIRONMENT,
        action: Action.LIST,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      undefined
    )
    return Converter.toEnvironments(res)
  }

  async getEnvironment(name: string, config?: CacheOptions) {
    const res = await this._execute<Target.ENVIRONMENT, Action.GET>(
      {
        target: Target.ENVIRONMENT,
        action: Action.GET,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      {
        name,
      }
    )
    return Converter.toEnvironment(res)
  }

  getEnvironmentSync(name: string, config?: CacheOptions) {
    const res = this._executeSync<Target.ENVIRONMENT, Action.GET>(
      {
        target: Target.ENVIRONMENT,
        action: Action.GET,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      {
        name,
      }
    )
    return Converter.toEnvironment(res)
  }

  async createEnvironment(
    data: {
      name: string
      externalUrl: string
      description?: string
    },
    config?: CacheOptions
  ) {
    const res = await this._execute<Target.ENVIRONMENT, Action.CREATE>(
      {
        target: Target.ENVIRONMENT,
        action: Action.CREATE,
        fetch: config?.fetch,
        restTime: config?.restTime,
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
    data: { externalUrl: string; description?: string },
    config?: CacheOptions
  ) {
    const res = await this._execute<Target.ENVIRONMENT, Action.UPDATE>(
      {
        target: Target.ENVIRONMENT,
        action: Action.UPDATE,
        fetch: config?.fetch,
        restTime: config?.restTime,
      },
      {
        name,
        newUrl: data.externalUrl,
        newDescription: data.description,
      }
    )
    return Converter.toEnvironment(res)
  }

  // ----------------- PRIVATE METHODS -----------------

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
          fetch: config.fetch || this.cacheOptions?.fetch,
          restTime: config.restTime ?? this.cacheOptions?.restTime,
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
          fetch: config.fetch || this.cacheOptions?.fetch,
          restTime: config.restTime ?? this.cacheOptions?.restTime,
        },
        data
      )
    } catch (error) {
      throw Converter.toError((error as any).toString())
    }
  }
}
