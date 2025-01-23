export enum Target {
  ENVIRONMENT = 'environment',
  SECRET = 'secret',
}

export enum Action {
  CREATE = 'create',
  GET = 'get',
  LIST = 'list',
  UPDATE = 'update',
  IMPORT = 'import',
}

export type ExportFormat = 'txt' | 'json' | 'env'

export type CommandConfig = {
  target: Target
  action: Action
  accessKeyId: string
  secretAccessKey: string
  apiBase: string
  headers?: { [key: string]: any }
  unsafe?: boolean
  fetch?: boolean
  restTime?: number
  output?: string
  outputFormat?: ExportFormat
}

export interface CommandData {
  [Target.SECRET]: {
    [Action.CREATE]: {
      key: string
      value: string
      environment?: string
      description?: string
    }
    [Action.GET]: {
      key: string
      environment?: string
    }
    [Action.LIST]: {
      environment?: string
    }
    [Action.UPDATE]: {
      key: string
      environment?: string
      newKey?: string
      newValue?: string
      newEnvironment?: string
      newDescription?: string
    }
    [Action.IMPORT]: {
      source: string
    }
  }

  [Target.ENVIRONMENT]: {
    [Action.CREATE]: {
      name: string
      url: string
      description?: string
    }
    [Action.GET]: {
      name: string
    }
    [Action.LIST]: undefined
    [Action.UPDATE]: {
      name: string
      newName?: string
      newUrl?: string
      newDescription?: string
    }

    // Not available
    [Action.IMPORT]: undefined
  }
}

export interface Executor {
  runCommand: (
    params: CommandConfig,
    data: CommandData[Target][Action]
  ) => Promise<string>
  runCommandSync: (
    params: CommandConfig,
    data: CommandData[Target][Action]
  ) => string
}
