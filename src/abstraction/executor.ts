import type { RequestID } from './errors.js'

export const PROTOCOL_NAME = 'locker.sdk'
export const PROTOCOL_VERSION = 1
export const JSON_RPC_VERSION = '2.0'
export const DEFAULT_MAX_REQUEST_BYTES = 20 * 1024 * 1024
export const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export type ExportFormat = 'txt' | 'json' | 'env'

export type LockerMethod =
  | 'environment.create'
  | 'environment.get'
  | 'environment.list'
  | 'environment.list_page'
  | 'environment.update'
  | 'secret.create'
  | 'secret.get'
  | 'secret.list'
  | 'secret.list_page'
  | 'secret.update'

export type CacheOptions = {
  fetch?: boolean
  restTime?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type VaultContext = {
  accessKeyId: string
  secretAccessKey: string
  apiBase?: string
  headers?: Readonly<Record<string, string>>
  unsafe?: boolean
  fetch?: boolean
  restTime?: number
}

export type ExecuteOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export type ProtocolCapabilities = {
  protocol: {
    name: string
    min_version: number
    max_version: number
    transport: string
  }
  cli: {
    version: string
  }
  methods: string[]
  error_contracts?: string[]
  limits: {
    max_request_bytes: number
    max_response_bytes: number
    max_json_depth?: number
  }
}

export interface ProtocolExecutor {
  execute<T>(
    method: LockerMethod,
    context: VaultContext,
    params: Readonly<Record<string, unknown>>,
    options?: ExecuteOptions,
  ): Promise<T>

  executeSync<T>(
    method: LockerMethod,
    context: VaultContext,
    params: Readonly<Record<string, unknown>>,
    options?: ExecuteOptions,
  ): T
}

export type JSONRPCRequest = {
  jsonrpc: typeof JSON_RPC_VERSION
  id: RequestID
  method: string
  params: Readonly<Record<string, unknown>>
}

/**
 * Legacy human-command abstractions kept for source compatibility. New code
 * must use {@link ProtocolExecutor}; human CLI flags are not an SDK protocol.
 */
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

export type CommandConfig = {
  target: Target
  action: Action
  accessKeyId: string
  secretAccessKey: string
  apiBase: string
  headers?: Record<string, unknown>
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
    [Action.IMPORT]: undefined
  }
}

/**
 * @deprecated Human-facing command execution is retained only as a type-level
 * compatibility shim. SDK implementations use {@link ProtocolExecutor}.
 */
export interface Executor {
  runCommand(
    params: CommandConfig,
    data: CommandData[Target][Action],
  ): Promise<string>
  runCommandSync(
    params: CommandConfig,
    data: CommandData[Target][Action],
  ): string
}
