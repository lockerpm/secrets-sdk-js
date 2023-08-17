import { LogLevel } from '.'

export enum Target {
  ENVIRONMENT = 'environment',
  SECRET = 'secret',
}

export enum Action {
  CREATE = 'create',
  GET = 'get',
  LIST = 'list',
  UPDATE = 'update',
}

export type CommandParams = {
  target: Target
  action: Action
  accessKey: string
  apiBase: string
  id?: string // Key name
  env?: string
  data?: { [key: string]: any }
  headers?: { [key: string]: any }
}

export interface Executor {
  setLogLevel: (level: LogLevel) => void
  runCommand: (params: CommandParams) => Promise<string>
  runCommandSync: (params: CommandParams) => string
}
