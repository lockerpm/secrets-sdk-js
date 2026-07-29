import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  JSON_RPC_VERSION,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type ExecuteOptions,
  type JSONRPCRequest,
  type LockerMethod,
  type ProtocolExecutor,
  type ProtocolCapabilities,
  type VaultContext,
} from '../abstraction/executor.js'
import {
  ErrorCode,
  LockerCancelledError,
  LockerError,
  LockerProtocolError,
  LockerTimeoutError,
  LockerTransportError,
  errorFromResponse,
  type RequestID,
} from '../abstraction/errors.js'
import {
  bindCLIPathForExecution,
  bindCLIPathForExecutionAsync,
  CLIResolutionCancelledError,
  CLIResolutionTimeoutError,
  resolveCLIPath,
} from '../cli/resolver.js'
import { Logger } from '../utils/logger.js'
import {
  MAX_JSON_DEPTH,
  assertJSONDepth,
  parseStrictJSON,
} from '../utils/json.js'
import { SDK_VERSION } from '../version.js'
import {
  NodeProcessRunner,
  ProcessFailure,
  ProcessFailureReason,
  type ProcessExecutionOptions,
  type ProcessExecutionResult,
  type ProcessRunner,
} from './process.js'

const SDK_ARGUMENTS = Object.freeze(['sdk'] as const)
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 2_147_483_647
const DEFAULT_MAX_OUTPUT_BYTES = DEFAULT_MAX_RESPONSE_BYTES
const MAX_OUTPUT_BYTES = DEFAULT_MAX_RESPONSE_BYTES
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const EXPECTED_TRANSPORT = 'json-rpc-2.0-stdio'

const REQUIRED_METHODS: readonly string[] = Object.freeze([
  'environment.create',
  'environment.get',
  'environment.list',
  'environment.update',
  'secret.create',
  'secret.get',
  'secret.list',
  'secret.update',
  'system.capabilities',
])

export type BinaryExecutorOptions = {
  cliPath?: string
  clientVersion?: string
  timeoutMs?: number
  maxBufferBytes?: number
  runner?: ProcessRunner
}

type JSONRPCErrorPayload = {
  code: number
  message: string
  data: {
    protocol_version: number
    kind: string
    retryable: boolean
    retry_after_seconds?: number
    server_request_id?: string
  }
}

type JSONRPCResultPayload = {
  protocol_version: number
  data: unknown
  meta: {
    cli_version: string
  }
}

type DecodedRPCResult<T> = {
  data: T
  cliVersion: string
}

type ExecutionBudget = {
  deadlineMs: number
  signal?: AbortSignal
}

type ExecutionBinding = {
  path: string
  identity: string
  options: ExecuteOptions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function positiveSafeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return resolved
}

function protocolContext(
  context: VaultContext,
  clientVersion: string,
  typedErrorContract: boolean,
) {
  const transport: Record<string, unknown> = {}
  if (context.apiBase !== undefined) {
    transport.api_base = context.apiBase
  }
  if (context.headers !== undefined) {
    transport.headers = { ...context.headers }
  }
  if (context.unsafe !== undefined) {
    transport.insecure_skip_tls_verify = context.unsafe
  }

  const cache: Record<string, unknown> = {}
  if (context.fetch !== undefined) {
    cache.force_refresh = context.fetch
  }
  if (context.restTime !== undefined) {
    cache.max_age_seconds = context.restTime
  }

  return {
    protocol_version: PROTOCOL_VERSION,
    ...(typedErrorContract ? { error_contract: 'typed-v1' } : {}),
    credentials: {
      access_key_id: context.accessKeyId,
      secret_access_key: context.secretAccessKey,
    },
    client: {
      name: 'locker-js',
      version: clientVersion,
    },
    ...(Object.keys(transport).length === 0 ? {} : { transport }),
    ...(Object.keys(cache).length === 0 ? {} : { cache }),
  }
}

function parseErrorPayload(value: unknown): JSONRPCErrorPayload | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const data = value.data
  if (
    !Number.isSafeInteger(value.code) ||
    typeof value.message !== 'string' ||
    !isValidErrorMessage(value.message) ||
    !isRecord(data) ||
    !Number.isInteger(data.protocol_version) ||
    typeof data.kind !== 'string' ||
    !isValidErrorKind(data.kind) ||
    typeof data.retryable !== 'boolean' ||
    (hasOwn(data, 'retry_after_seconds') &&
      (!Number.isInteger(data.retry_after_seconds) ||
        (data.retry_after_seconds as number) < 0 ||
        (data.retry_after_seconds as number) > 86400)) ||
    (hasOwn(data, 'server_request_id') &&
      (typeof data.server_request_id !== 'string' ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(data.server_request_id)))
  ) {
    return undefined
  }
  return value as JSONRPCErrorPayload
}

function isValidErrorKind(kind: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(kind)
}

function isValidErrorMessage(message: string): boolean {
  if (message.length === 0) {
    return false
  }
  let scalars = 0
  for (const value of message) {
    const codePoint = value.codePointAt(0)
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      ++scalars > 512
    ) {
      return false
    }
  }
  return true
}

function parseResultPayload(value: unknown): JSONRPCResultPayload | undefined {
  if (
    !isRecord(value) ||
    value.protocol_version !== PROTOCOL_VERSION ||
    !hasOwn(value, 'data') ||
    !isRecord(value.meta) ||
    typeof value.meta.cli_version !== 'string' ||
    value.meta.cli_version.trim() === ''
  ) {
    return undefined
  }
  return value as JSONRPCResultPayload
}

function parseCapabilities(value: unknown): ProtocolCapabilities | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.protocol) ||
    typeof value.protocol.name !== 'string' ||
    !Number.isSafeInteger(value.protocol.min_version) ||
    !Number.isSafeInteger(value.protocol.max_version) ||
    (value.protocol.min_version as number) < 1 ||
    (value.protocol.max_version as number) < 1 ||
    (value.protocol.min_version as number) >
      (value.protocol.max_version as number) ||
    typeof value.protocol.transport !== 'string' ||
    !isRecord(value.cli) ||
    typeof value.cli.version !== 'string' ||
    value.cli.version.trim() === '' ||
    !Array.isArray(value.methods) ||
    !value.methods.every(
      (method) => typeof method === 'string' && method.trim() !== '',
    ) ||
    new Set(value.methods).size !== value.methods.length ||
    (value.error_contracts !== undefined &&
      (!Array.isArray(value.error_contracts) ||
        value.error_contracts.length > 8 ||
        !value.error_contracts.every(
          (contract) =>
            typeof contract === 'string' &&
            /^[a-z][a-z0-9-]{0,31}$/.test(contract),
        ) ||
        new Set(value.error_contracts).size !==
          value.error_contracts.length)) ||
    !isRecord(value.limits) ||
    !Number.isSafeInteger(value.limits.max_request_bytes) ||
    (value.limits.max_request_bytes as number) <= 0 ||
    !Number.isSafeInteger(value.limits.max_response_bytes) ||
    (value.limits.max_response_bytes as number) <= 0 ||
    (value.limits.max_json_depth !== undefined &&
      (!Number.isSafeInteger(value.limits.max_json_depth) ||
        (value.limits.max_json_depth as number) <= 0))
  ) {
    return undefined
  }
  return value as ProtocolCapabilities
}

function responseIDMatches(expected: RequestID, actual: unknown): boolean {
  return (
    (typeof actual === 'string' || typeof actual === 'number') &&
    Object.is(expected, actual)
  )
}

function executableIdentity(binaryPath: string): string | undefined {
  try {
    const canonicalPath = realpathSync.native(binaryPath)
    const info = statSync(canonicalPath, { bigint: true })
    if (!info.isFile()) {
      return undefined
    }
    return [
      canonicalPath,
      info.dev,
      info.ino,
      info.size,
      info.mtimeNs,
      info.ctimeNs,
    ].join(':')
  } catch {
    return undefined
  }
}

export class BinaryExecutor implements ProtocolExecutor {
  readonly logger: Logger

  private readonly configuredCLIPath?: string
  private binaryPath: string
  private binaryIdentity?: string
  private readonly clientVersion: string
  private readonly defaultTimeoutMs: number
  private readonly maxOutputBytes: number
  private readonly runner: ProcessRunner
  private capabilities?: ProtocolCapabilities
  private capabilityIdentity?: string
  private capabilityPromise?: Promise<ProtocolCapabilities>

  constructor(logger: Logger, options: BinaryExecutorOptions = {}) {
    this.logger = logger
    this.configuredCLIPath = options.cliPath
    this.clientVersion = options.clientVersion?.trim() || SDK_VERSION
    this.defaultTimeoutMs = positiveSafeInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      'timeoutMs',
    )
    if (this.defaultTimeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError(`timeoutMs must not exceed ${MAX_TIMEOUT_MS}`)
    }
    try {
      this.binaryPath = resolveCLIPath(this.configuredCLIPath, {
        timeoutMs: this.defaultTimeoutMs,
      })
    } catch (cause) {
      this.throwResolutionError(cause, 'system.capabilities')
    }
    this.binaryIdentity = executableIdentity(this.binaryPath)
    this.maxOutputBytes = positiveSafeInteger(
      options.maxBufferBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      'maxBufferBytes',
    )
    if (this.maxOutputBytes > MAX_OUTPUT_BYTES) {
      throw new RangeError(
        `maxBufferBytes must not exceed ${MAX_OUTPUT_BYTES} bytes`,
      )
    }
    this.runner = options.runner ?? new NodeProcessRunner()
  }

  async execute<T>(
    method: LockerMethod,
    context: VaultContext,
    params: Readonly<Record<string, unknown>>,
    options: ExecuteOptions = {},
  ): Promise<T> {
    const budget = this.executionBudget(options)
    const shareCapabilityNegotiation =
      options.signal === undefined && options.timeoutMs === undefined
    this.refreshBinaryIdentity(method, this.remainingOptions(budget, method))
    let capabilities = await this.ensureCapabilities(
      this.remainingOptions(budget, method),
      shareCapabilityNegotiation,
    )
    this.refreshBinaryIdentity(method, this.remainingOptions(budget, method))
    if (this.capabilities !== capabilities) {
      capabilities = await this.ensureCapabilities(
        this.remainingOptions(budget, method),
        shareCapabilityNegotiation,
      )
    }
    this.requireMethod(capabilities, method)
    const result = await this.runRPC<T>(
      method,
      {
        context: protocolContext(
          context,
          this.clientVersion,
          capabilities.error_contracts?.includes('typed-v1') === true,
        ),
        ...params,
      },
      this.remainingOptions(budget, method),
      Math.min(
        capabilities.limits.max_request_bytes,
        DEFAULT_MAX_REQUEST_BYTES,
      ),
      Math.min(capabilities.limits.max_response_bytes, this.maxOutputBytes),
      Math.min(
        capabilities.limits.max_json_depth ?? MAX_JSON_DEPTH,
        MAX_JSON_DEPTH,
      ),
    )
    this.requireCLIVersion(result.cliVersion, capabilities.cli.version, method)
    this.remainingOptions(budget, method)
    return result.data
  }

  executeSync<T>(
    method: LockerMethod,
    context: VaultContext,
    params: Readonly<Record<string, unknown>>,
    options: ExecuteOptions = {},
  ): T {
    const budget = this.executionBudget(options)
    this.refreshBinaryIdentity(method, this.remainingOptions(budget, method))
    let capabilities = this.ensureCapabilitiesSync(
      this.remainingOptions(budget, method),
    )
    this.refreshBinaryIdentity(method, this.remainingOptions(budget, method))
    if (this.capabilities !== capabilities) {
      capabilities = this.ensureCapabilitiesSync(
        this.remainingOptions(budget, method),
      )
    }
    this.requireMethod(capabilities, method)
    const result = this.runRPCSync<T>(
      method,
      {
        context: protocolContext(
          context,
          this.clientVersion,
          capabilities.error_contracts?.includes('typed-v1') === true,
        ),
        ...params,
      },
      this.remainingOptions(budget, method),
      Math.min(
        capabilities.limits.max_request_bytes,
        DEFAULT_MAX_REQUEST_BYTES,
      ),
      Math.min(capabilities.limits.max_response_bytes, this.maxOutputBytes),
      Math.min(
        capabilities.limits.max_json_depth ?? MAX_JSON_DEPTH,
        MAX_JSON_DEPTH,
      ),
    )
    this.requireCLIVersion(result.cliVersion, capabilities.cli.version, method)
    this.remainingOptions(budget, method)
    return result.data
  }

  private executionBudget(options: ExecuteOptions): ExecutionBudget {
    const timeoutMs = positiveSafeInteger(
      options.timeoutMs,
      this.defaultTimeoutMs,
      'timeoutMs',
    )
    if (timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError(`timeoutMs must not exceed ${MAX_TIMEOUT_MS}`)
    }
    return {
      deadlineMs: performance.now() + timeoutMs,
      signal: options.signal,
    }
  }

  private remainingOptions(
    budget: ExecutionBudget,
    method: LockerMethod,
  ): ExecuteOptions {
    if (budget.signal?.aborted) {
      throw new LockerCancelledError('Locker CLI request was cancelled', {
        method,
        requestId: 'operation-budget',
      })
    }
    const timeoutMs = Math.ceil(budget.deadlineMs - performance.now())
    if (timeoutMs <= 0) {
      throw new LockerTimeoutError(
        'Locker SDK operation exceeded its total timeout',
        {
          method,
          requestId: 'operation-budget',
        },
      )
    }
    return {
      signal: budget.signal,
      timeoutMs,
    }
  }

  private async ensureCapabilities(
    options: ExecuteOptions,
    shareNegotiation = false,
  ): Promise<ProtocolCapabilities> {
    if (this.capabilities && this.capabilityIdentity === this.binaryIdentity) {
      return this.capabilities
    }
    this.capabilities = undefined
    this.capabilityIdentity = undefined
    // A caller-specific signal/timeout must never poison unrelated concurrent
    // callers. Only the default negotiation is shared.
    if (!shareNegotiation) {
      const negotiationIdentity = this.binaryIdentity
      const negotiated = await this.negotiateCapabilities(options)
      if (negotiationIdentity !== this.binaryIdentity) {
        throw new LockerTransportError(
          'Locker CLI executable changed during capability negotiation',
          {
            method: 'system.capabilities',
            requestId: 'binary-identity',
          },
        )
      }
      this.capabilities ??= negotiated
      this.capabilityIdentity ??= negotiationIdentity
      return this.capabilities
    }
    if (!this.capabilityPromise) {
      this.capabilityPromise = this.negotiateCapabilities(options)
    }
    const negotiationIdentity = this.binaryIdentity
    try {
      const negotiated = await this.capabilityPromise
      if (negotiationIdentity !== this.binaryIdentity) {
        throw new LockerTransportError(
          'Locker CLI executable changed during capability negotiation',
          {
            method: 'system.capabilities',
            requestId: 'binary-identity',
          },
        )
      }
      this.capabilities = negotiated
      this.capabilityIdentity = negotiationIdentity
      return this.capabilities
    } catch (error) {
      this.capabilityPromise = undefined
      throw error
    }
  }

  private ensureCapabilitiesSync(
    options: ExecuteOptions,
  ): ProtocolCapabilities {
    if (this.capabilities && this.capabilityIdentity === this.binaryIdentity) {
      return this.capabilities
    }
    this.capabilities = undefined
    this.capabilityIdentity = undefined
    const identityBefore = this.binaryIdentity
    const raw = this.runRPCSync<unknown>(
      'system.capabilities',
      {},
      options,
      DEFAULT_MAX_REQUEST_BYTES,
      this.maxOutputBytes,
      MAX_JSON_DEPTH,
    )
    const identityAfter = executableIdentity(this.binaryPath)
    if (
      identityBefore !== undefined &&
      (identityAfter === undefined || identityAfter !== identityBefore)
    ) {
      throw new LockerTransportError(
        'Locker CLI executable changed during capability negotiation',
        {
          method: 'system.capabilities',
          requestId: 'binary-identity',
        },
      )
    }
    this.capabilities = this.validateCapabilities(raw.data, raw.cliVersion)
    this.capabilityIdentity = identityAfter
    return this.capabilities
  }

  private async negotiateCapabilities(
    options: ExecuteOptions,
  ): Promise<ProtocolCapabilities> {
    const identityBefore = this.binaryIdentity
    const raw = await this.runRPC<unknown>(
      'system.capabilities',
      {},
      options,
      DEFAULT_MAX_REQUEST_BYTES,
      this.maxOutputBytes,
      MAX_JSON_DEPTH,
    )
    const identityAfter = executableIdentity(this.binaryPath)
    if (
      identityBefore !== undefined &&
      (identityAfter === undefined || identityAfter !== identityBefore)
    ) {
      throw new LockerTransportError(
        'Locker CLI executable changed during capability negotiation',
        {
          method: 'system.capabilities',
          requestId: 'binary-identity',
        },
      )
    }
    return this.validateCapabilities(raw.data, raw.cliVersion)
  }

  private validateCapabilities(
    value: unknown,
    responseCLIVersion: string,
  ): ProtocolCapabilities {
    const capabilities = parseCapabilities(value)
    if (
      !capabilities ||
      capabilities.protocol.name !== PROTOCOL_NAME ||
      capabilities.protocol.transport !== EXPECTED_TRANSPORT ||
      capabilities.protocol.min_version > PROTOCOL_VERSION ||
      capabilities.protocol.max_version < PROTOCOL_VERSION
    ) {
      throw new LockerTransportError(
        'Locker CLI returned incompatible protocol capabilities',
        {
          method: 'system.capabilities',
          requestId: 'capabilities',
        },
      )
    }
    this.requireCLIVersion(
      responseCLIVersion,
      capabilities.cli.version,
      'system.capabilities',
    )
    for (const method of REQUIRED_METHODS) {
      if (!capabilities.methods.includes(method)) {
        throw new LockerTransportError(
          'Locker CLI does not expose all required protocol methods',
          {
            method: 'system.capabilities',
            requestId: 'capabilities',
          },
        )
      }
    }
    return capabilities
  }

  private requireCLIVersion(
    actual: string,
    expected: string,
    method: string,
  ): void {
    if (actual !== expected) {
      throw new LockerTransportError(
        'Locker CLI response version differs from negotiated capabilities',
        {
          method,
          requestId: 'cli-version',
        },
      )
    }
  }

  private requireMethod(
    capabilities: ProtocolCapabilities,
    method: LockerMethod,
  ): void {
    if (!capabilities.methods.includes(method)) {
      throw new LockerTransportError(
        'Locker CLI does not support the requested SDK operation',
        {
          method,
          requestId: 'capabilities',
        },
      )
    }
  }

  private refreshBinaryIdentity(
    method: LockerMethod,
    options: ExecuteOptions,
  ): void {
    let resolved: string
    try {
      resolved = resolveCLIPath(this.configuredCLIPath, options)
    } catch (cause) {
      this.throwResolutionError(cause, method)
    }
    const observed = executableIdentity(resolved)
    if (resolved === this.binaryPath && observed === this.binaryIdentity) {
      return
    }
    const identity = observed
    if (identity === undefined) {
      throw new LockerTransportError(
        'Locker CLI executable identity is unavailable',
        {
          method,
          requestId: 'binary-resolution',
        },
      )
    }
    if (resolved !== this.binaryPath || identity !== this.binaryIdentity) {
      this.binaryPath = resolved
      this.binaryIdentity = identity
      this.capabilities = undefined
      this.capabilityIdentity = undefined
      this.capabilityPromise = undefined
    }
  }

  private throwResolutionError(
    cause: unknown,
    method: LockerMethod | 'system.capabilities',
  ): never {
    if (cause instanceof CLIResolutionCancelledError) {
      throw new LockerCancelledError('Locker CLI request was cancelled', {
        method,
        requestId: 'binary-resolution',
        cause,
      })
    }
    if (cause instanceof CLIResolutionTimeoutError) {
      throw new LockerTimeoutError(
        'Locker CLI resolution exceeded the operation timeout',
        {
          method,
          requestId: 'binary-resolution',
          cause,
        },
      )
    }
    throw new LockerTransportError(
      'Locker CLI failed local provenance verification',
      {
        method,
        requestId: 'binary-resolution',
        cause,
      },
    )
  }

  private processOptions(
    options: ExecuteOptions,
    maxResponseBytes: number,
  ): ProcessExecutionOptions {
    return {
      timeoutMs: positiveSafeInteger(
        options.timeoutMs,
        this.defaultTimeoutMs,
        'timeoutMs',
      ),
      maxStdoutBytes: Math.min(this.maxOutputBytes, maxResponseBytes),
      maxStderrBytes: Math.min(this.maxOutputBytes, DEFAULT_MAX_STDERR_BYTES),
      signal: options.signal,
    }
  }

  private bindExecutionPath(
    method: LockerMethod | 'system.capabilities',
    options: ExecuteOptions,
  ): ExecutionBinding {
    const startedAtMs = performance.now()
    let resolved: string
    try {
      resolved = bindCLIPathForExecution(this.configuredCLIPath, options)
    } catch (cause) {
      this.throwResolutionError(cause, method)
    }
    return this.finalizeExecutionBinding(resolved, method, options, startedAtMs)
  }

  private async bindExecutionPathAsync(
    method: LockerMethod | 'system.capabilities',
    options: ExecuteOptions,
  ): Promise<ExecutionBinding> {
    const startedAtMs = performance.now()
    let resolved: string
    try {
      resolved = await bindCLIPathForExecutionAsync(
        this.configuredCLIPath,
        options,
      )
    } catch (cause) {
      this.throwResolutionError(cause, method)
    }
    return this.finalizeExecutionBinding(resolved, method, options, startedAtMs)
  }

  private finalizeExecutionBinding(
    resolved: string,
    method: LockerMethod | 'system.capabilities',
    options: ExecuteOptions,
    startedAtMs: number,
  ): ExecutionBinding {
    const identity = executableIdentity(resolved)
    if (identity === undefined) {
      throw new LockerTransportError(
        'Locker CLI executable identity is unavailable after verification',
        {
          method,
          requestId: 'binary-verification',
        },
      )
    }
    if (resolved !== this.binaryPath || identity !== this.binaryIdentity) {
      this.binaryPath = resolved
      this.binaryIdentity = identity
      this.capabilities = undefined
      this.capabilityIdentity = undefined
      this.capabilityPromise = undefined
      throw new LockerTransportError(
        'Locker CLI executable changed before the protocol operation',
        {
          method,
          requestId: 'binary-verification',
        },
      )
    }
    if (options.signal?.aborted) {
      throw new LockerCancelledError('Locker CLI request was cancelled', {
        method,
        requestId: 'binary-verification',
      })
    }
    const originalTimeoutMs = positiveSafeInteger(
      options.timeoutMs,
      this.defaultTimeoutMs,
      'timeoutMs',
    )
    const timeoutMs = Math.floor(
      originalTimeoutMs - (performance.now() - startedAtMs),
    )
    if (timeoutMs <= 0) {
      throw new LockerTimeoutError(
        'Locker CLI verification exhausted the operation timeout',
        {
          method,
          requestId: 'binary-verification',
        },
      )
    }
    return {
      path: resolved,
      identity,
      options: {
        signal: options.signal,
        timeoutMs,
      },
    }
  }

  private encodeRequest(
    method: string,
    params: Readonly<Record<string, unknown>>,
    maxRequestBytes: number,
    maxJSONDepth: number,
  ): { id: RequestID; buffer: Buffer } {
    const id = randomUUID()
    const request: JSONRPCRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    }
    let encoded: string
    try {
      assertJSONDepth(request, maxJSONDepth)
      encoded = JSON.stringify(request)
    } catch {
      throw new LockerTransportError(
        'Locker SDK request cannot be encoded as protocol JSON',
        { method, requestId: id },
      )
    }
    const buffer = Buffer.from(encoded, 'utf8')
    if (buffer.length > maxRequestBytes) {
      buffer.fill(0)
      throw new LockerTransportError(
        'Locker SDK request exceeds the CLI size limit',
        { method, requestId: id },
      )
    }
    return { id, buffer }
  }

  private async runRPC<T>(
    method: LockerMethod | 'system.capabilities',
    params: Readonly<Record<string, unknown>>,
    options: ExecuteOptions,
    maxRequestBytes: number,
    maxResponseBytes: number,
    maxJSONDepth: number,
  ): Promise<DecodedRPCResult<T>> {
    const { id, buffer } = this.encodeRequest(
      method,
      params,
      maxRequestBytes,
      maxJSONDepth,
    )
    try {
      const binding = await this.bindExecutionPathAsync(method, options)
      const processResult = await this.runner.run(
        binding.path,
        SDK_ARGUMENTS,
        buffer,
        this.processOptions(binding.options, maxResponseBytes),
      )
      const result = this.decodeResponse<T>(processResult.stdout, method, id)
      if (executableIdentity(binding.path) !== binding.identity) {
        throw new LockerTransportError(
          'Locker CLI executable changed during the protocol operation',
          { method, requestId: id },
        )
      }
      this.logSuccess(method, id, processResult)
      return result
    } catch (error) {
      this.logFailure(method, id, error)
      throw this.transportError(error, method, id)
    } finally {
      buffer.fill(0)
    }
  }

  private runRPCSync<T>(
    method: LockerMethod | 'system.capabilities',
    params: Readonly<Record<string, unknown>>,
    options: ExecuteOptions,
    maxRequestBytes: number,
    maxResponseBytes: number,
    maxJSONDepth: number,
  ): DecodedRPCResult<T> {
    const { id, buffer } = this.encodeRequest(
      method,
      params,
      maxRequestBytes,
      maxJSONDepth,
    )
    try {
      const binding = this.bindExecutionPath(method, options)
      const processResult = this.runner.runSync(
        binding.path,
        SDK_ARGUMENTS,
        buffer,
        this.processOptions(binding.options, maxResponseBytes),
      )
      const result = this.decodeResponse<T>(processResult.stdout, method, id)
      if (executableIdentity(binding.path) !== binding.identity) {
        throw new LockerTransportError(
          'Locker CLI executable changed during the protocol operation',
          { method, requestId: id },
        )
      }
      this.logSuccess(method, id, processResult)
      return result
    } catch (error) {
      this.logFailure(method, id, error)
      throw this.transportError(error, method, id)
    } finally {
      buffer.fill(0)
    }
  }

  private decodeResponse<T>(
    stdout: string,
    method: string,
    requestId: RequestID,
  ): DecodedRPCResult<T> {
    let parsed: unknown
    try {
      parsed = parseStrictJSON(stdout)
    } catch {
      throw new LockerTransportError(
        'Locker CLI returned malformed JSON protocol output',
        { method, requestId },
      )
    }
    if (
      !isRecord(parsed) ||
      parsed.jsonrpc !== JSON_RPC_VERSION ||
      !responseIDMatches(requestId, parsed.id)
    ) {
      throw new LockerTransportError(
        'Locker CLI returned an invalid JSON-RPC envelope',
        { method, requestId },
      )
    }

    const hasResult = hasOwn(parsed, 'result')
    const hasError = hasOwn(parsed, 'error')
    if (hasResult === hasError) {
      throw new LockerTransportError(
        'Locker CLI response must contain exactly one result or error',
        { method, requestId },
      )
    }

    if (hasError) {
      const error = parseErrorPayload(parsed.error)
      if (!error || error.data.protocol_version !== PROTOCOL_VERSION) {
        throw new LockerProtocolError(
          'Locker CLI returned an invalid JSON-RPC error',
          {
            code: ErrorCode.INTERNAL,
            kind: 'invalid_response',
            retryable: false,
            requestId,
          },
        )
      }
      throw errorFromResponse(
        error.code,
        error.message,
        error.data.kind,
        error.data.retryable,
        requestId,
        error.data.retry_after_seconds,
        error.data.server_request_id,
      )
    }

    const result = parseResultPayload(parsed.result)
    if (!result) {
      throw new LockerTransportError(
        'Locker CLI returned an invalid JSON-RPC result',
        { method, requestId },
      )
    }
    return {
      data: result.data as T,
      cliVersion: result.meta.cli_version,
    }
  }

  private transportError(
    error: unknown,
    method: string,
    requestId: RequestID,
  ): unknown {
    if (error instanceof LockerTransportError || error instanceof LockerError) {
      return error
    }
    if (error instanceof ProcessFailure) {
      const details = { method, requestId, cause: error.cause }
      if (error.reason === ProcessFailureReason.ABORTED) {
        return new LockerCancelledError(
          'Locker CLI request was cancelled',
          details,
        )
      }
      if (error.reason === ProcessFailureReason.TIMEOUT) {
        return new LockerTimeoutError('Locker CLI request timed out', details)
      }
      return new LockerTransportError(
        'Locker CLI could not complete the protocol exchange',
        details,
      )
    }
    return new LockerTransportError(
      'Locker SDK could not complete the protocol exchange',
      { method, requestId, cause: error },
    )
  }

  private logSuccess(
    method: string,
    requestId: RequestID,
    result: ProcessExecutionResult,
  ): void {
    this.logger.debug({
      event: 'locker.sdk.request.completed',
      method,
      requestId,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
    })
  }

  private logFailure(
    method: string,
    requestId: RequestID,
    error: unknown,
  ): void {
    this.logger.error({
      event: 'locker.sdk.request.failed',
      method,
      requestId,
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
    })
  }
}
