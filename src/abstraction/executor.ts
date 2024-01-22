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
  secretAccessKey: string
  apiBase: string
  name?: string
  env?: string
  data?: { [key: string]: any }
  headers?: { [key: string]: any }
  unsafe?: boolean
}

export interface Executor {
  runCommand: (params: CommandParams) => Promise<string>
  runCommandSync: (params: CommandParams) => string
}
