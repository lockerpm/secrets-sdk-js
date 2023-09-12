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
  accessKeyId: string
  accessKeySecret: string
  apiBase: string
  name?: string
  env?: string
  data?: { [key: string]: any }
  headers?: { [key: string]: any }
}

export interface Executor {
  runCommand: (params: CommandParams) => Promise<string>
  runCommandSync: (params: CommandParams) => string
}
