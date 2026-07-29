export const ErrorCode = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  OPERATION_FAILED: -32000,
  AUTHENTICATION: -32001,
  PERMISSION_DENIED: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  VALIDATION: -32022,
  RATE_LIMITED: -32029,
  NETWORK: -32050,
  SERVER: -32051,
  STORAGE: -32060,
  INTEGRITY: -32070,
} as const

export type LockerErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
export type RequestID = string | number

export type LockerErrorDetails = {
  code: number
  kind: string
  retryable: boolean
  requestId: RequestID
  retryAfterSeconds?: number
  serverRequestId?: string
}

/**
 * @deprecated Protocol v1 reports an explicit `LockerNotFoundError`; empty
 * human-command output is no longer used as a control signal.
 */
export class EmptyOutputError extends Error {
  constructor() {
    super('Get empty result from binary')
    this.name = 'EmptyOutputError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Base class for errors returned by a completed Locker SDK protocol exchange.
 *
 * The request payload and CLI output are deliberately not retained here:
 * either can contain credentials or plaintext secret values.
 */
export class LockerError extends Error {
  readonly code: number
  readonly kind: string
  readonly retryable: boolean
  readonly requestId: RequestID
  readonly retryAfterSeconds?: number
  readonly serverRequestId?: string

  constructor(message: string, details: LockerErrorDetails) {
    super(message)
    this.name = 'LockerError'
    this.code = details.code
    this.kind = details.kind
    this.retryable = details.retryable
    this.requestId = details.requestId
    this.retryAfterSeconds = details.retryAfterSeconds
    this.serverRequestId = details.serverRequestId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class LockerProtocolError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerProtocolError'
  }
}

export class LockerAuthenticationError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerAuthenticationError'
  }
}

export class LockerPermissionError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerPermissionError'
  }
}

export class LockerNotFoundError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerNotFoundError'
  }
}

export class LockerConflictError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerConflictError'
  }
}

export class LockerAlreadyExistsError extends LockerConflictError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerAlreadyExistsError'
  }
}

export class LockerValidationError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerValidationError'
  }
}

export class LockerRequestRejectedError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerRequestRejectedError'
  }
}

export class LockerResponseTooLargeError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerResponseTooLargeError'
  }
}

export class LockerOperationCancelledError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerOperationCancelledError'
  }
}

export class LockerRateLimitError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerRateLimitError'
  }
}

export class LockerNetworkError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerNetworkError'
  }
}

export class LockerServerError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerServerError'
  }
}

export class LockerStorageError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerStorageError'
  }
}

export class LockerIntegrityError extends LockerError {
  constructor(message: string, details: LockerErrorDetails) {
    super(message, details)
    this.name = 'LockerIntegrityError'
  }
}

export type LockerTransportErrorDetails = {
  method: string
  requestId: RequestID
  cause?: unknown
}

/**
 * Raised when the CLI process cannot complete a valid protocol exchange.
 */
export class LockerTransportError extends Error {
  readonly method: string
  readonly requestId: RequestID
  override readonly cause?: unknown

  constructor(message: string, details: LockerTransportErrorDetails) {
    super(message)
    this.name = 'LockerTransportError'
    this.method = details.method
    this.requestId = details.requestId
    this.cause = details.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class LockerTimeoutError extends LockerTransportError {
  constructor(message: string, details: LockerTransportErrorDetails) {
    super(message, details)
    this.name = 'LockerTimeoutError'
  }
}

export class LockerCancelledError extends LockerTransportError {
  constructor(message: string, details: LockerTransportErrorDetails) {
    super(message, details)
    this.name = 'LockerCancelledError'
  }
}

export function isLockerNotFoundError(
  error: unknown,
): error is LockerNotFoundError {
  return (
    error instanceof LockerNotFoundError ||
    (error instanceof LockerError && error.code === ErrorCode.NOT_FOUND)
  )
}

export function isLockerConflictError(
  error: unknown,
): error is LockerConflictError {
  return (
    error instanceof LockerConflictError ||
    (error instanceof LockerError &&
      (error.code === ErrorCode.CONFLICT ||
        (error.code === ErrorCode.OPERATION_FAILED &&
          (error.kind === 'conflict' || isAlreadyExistsKind(error.kind)))))
  )
}

export function isLockerAlreadyExistsError(
  error: unknown,
): error is LockerAlreadyExistsError {
  return (
    error instanceof LockerAlreadyExistsError ||
    (error instanceof LockerError &&
      (error.code === ErrorCode.CONFLICT ||
        error.code === ErrorCode.OPERATION_FAILED) &&
      isAlreadyExistsKind(error.kind))
  )
}

export function errorFromResponse(
  code: number,
  _message: string,
  kind: string,
  retryable: boolean,
  requestId: RequestID,
  retryAfterSeconds?: number,
  serverRequestId?: string,
): LockerError {
  const effectiveRetryable = retryable && !isNormativelyNonRetryable(code, kind)
  const details = {
    code,
    kind,
    retryable: effectiveRetryable,
    requestId,
    ...(code === ErrorCode.RATE_LIMITED &&
    kind === 'rate_limited' &&
    retryAfterSeconds !== undefined
      ? { retryAfterSeconds }
      : {}),
    ...(serverRequestId === undefined ? {} : { serverRequestId }),
  }
  const message = safeErrorMessage(code, kind)
  if (!isStandardProtocolCode(code) && !isLockerServerErrorCode(code)) {
    return new LockerProtocolError('unsupported JSON-RPC error code', {
      ...details,
      retryable: false,
    })
  }
  if (
    (code === ErrorCode.CONFLICT || code === ErrorCode.OPERATION_FAILED) &&
    isAlreadyExistsKind(kind)
  ) {
    return new LockerAlreadyExistsError(message, details)
  }
  if (
    code === ErrorCode.CONFLICT ||
    (code === ErrorCode.OPERATION_FAILED && kind === 'conflict')
  ) {
    return new LockerConflictError(message, details)
  }
  if (
    code === ErrorCode.VALIDATION ||
    (code === ErrorCode.OPERATION_FAILED && kind === 'validation_error')
  ) {
    return new LockerValidationError(message, details)
  }
  if (
    code === ErrorCode.INTEGRITY ||
    (code === ErrorCode.OPERATION_FAILED && isIntegrityKind(kind))
  ) {
    return new LockerIntegrityError(message, details)
  }
  if (code === ErrorCode.OPERATION_FAILED && kind === 'request_rejected') {
    return new LockerRequestRejectedError(message, details)
  }
  if (code === ErrorCode.OPERATION_FAILED && kind === 'response_too_large') {
    return new LockerResponseTooLargeError(message, details)
  }
  if (code === ErrorCode.OPERATION_FAILED && kind === 'cancelled') {
    return new LockerOperationCancelledError(message, details)
  }
  switch (code) {
    case ErrorCode.PARSE:
    case ErrorCode.INVALID_REQUEST:
    case ErrorCode.METHOD_NOT_FOUND:
    case ErrorCode.INVALID_PARAMS:
    case ErrorCode.INTERNAL:
      return new LockerProtocolError(message, details)
    case ErrorCode.AUTHENTICATION:
      return new LockerAuthenticationError(message, details)
    case ErrorCode.PERMISSION_DENIED:
      return new LockerPermissionError(message, details)
    case ErrorCode.NOT_FOUND:
      return new LockerNotFoundError(message, details)
    case ErrorCode.RATE_LIMITED:
      return new LockerRateLimitError(message, details)
    case ErrorCode.NETWORK:
      return new LockerNetworkError(message, details)
    case ErrorCode.SERVER:
      return new LockerServerError(message, details)
    case ErrorCode.STORAGE:
      return new LockerStorageError(message, details)
    default:
      return new LockerError(message, details)
  }
}

function isAlreadyExistsKind(kind: string): boolean {
  return (
    kind === 'already_exists' ||
    kind === 'secret_already_exists' ||
    kind === 'environment_already_exists' ||
    kind === 'duplicate_hash'
  )
}

function isNormativelyNonRetryable(code: number, kind: string): boolean {
  return (
    isStandardProtocolCode(code) ||
    code === ErrorCode.AUTHENTICATION ||
    code === ErrorCode.PERMISSION_DENIED ||
    code === ErrorCode.NOT_FOUND ||
    code === ErrorCode.OPERATION_FAILED ||
    code === ErrorCode.CONFLICT ||
    code === ErrorCode.VALIDATION ||
    code === ErrorCode.STORAGE ||
    code === ErrorCode.INTEGRITY ||
    (code === ErrorCode.SERVER && kind === 'internal_error')
  )
}

function isIntegrityKind(kind: string): boolean {
  return (
    kind === 'integrity_error' ||
    kind === 'transport_integrity_error' ||
    kind === 'data_integrity_error' ||
    kind === 'data_error'
  )
}

function isStandardProtocolCode(code: number): boolean {
  return (
    code === ErrorCode.PARSE ||
    code === ErrorCode.INVALID_REQUEST ||
    code === ErrorCode.METHOD_NOT_FOUND ||
    code === ErrorCode.INVALID_PARAMS ||
    code === ErrorCode.INTERNAL
  )
}

function isLockerServerErrorCode(code: number): boolean {
  return Number.isSafeInteger(code) && code >= -32099 && code <= -32000
}

function safeErrorMessage(code: number, kind: string): string {
  if (
    (code === ErrorCode.CONFLICT || code === ErrorCode.OPERATION_FAILED) &&
    isAlreadyExistsKind(kind)
  ) {
    if (kind === 'secret_already_exists') {
      return 'a secret with this key already exists'
    }
    if (kind === 'environment_already_exists') {
      return 'an environment with this name already exists'
    }
    return 'the requested resource already exists'
  }

  switch (code) {
    case ErrorCode.PARSE:
      return 'the Locker CLI returned invalid JSON'
    case ErrorCode.INVALID_REQUEST:
      return 'the Locker CLI rejected the request envelope'
    case ErrorCode.METHOD_NOT_FOUND:
      return 'the requested Locker operation is not supported'
    case ErrorCode.INVALID_PARAMS:
      return 'the Locker request parameters are invalid'
    case ErrorCode.INTERNAL:
      return 'the Locker CLI encountered an internal protocol error'
    case ErrorCode.AUTHENTICATION:
      return 'authentication failed'
    case ErrorCode.PERMISSION_DENIED:
      return 'you do not have permission to perform this operation'
    case ErrorCode.NOT_FOUND:
      if (kind === 'secret_not_found') {
        return 'the requested secret was not found'
      }
      if (kind === 'environment_not_found') {
        return 'the requested environment was not found'
      }
      return 'the requested resource was not found'
    case ErrorCode.CONFLICT:
      return 'the operation conflicts with current state'
    case ErrorCode.VALIDATION:
      return 'the request is invalid'
    case ErrorCode.RATE_LIMITED:
      return 'too many requests; retry later'
    case ErrorCode.NETWORK:
      return kind === 'network_timeout'
        ? 'network request timed out'
        : 'network request failed'
    case ErrorCode.SERVER:
      if (kind === 'internal_error') {
        return 'the request could not be completed'
      }
      return 'the service is temporarily unavailable'
    case ErrorCode.STORAGE:
      return 'local storage operation failed'
    case ErrorCode.INTEGRITY:
      return integrityMessage(kind)
    default:
      if (code !== ErrorCode.OPERATION_FAILED) {
        return 'the Locker operation failed'
      }
      if (kind === 'conflict') {
        return 'the operation conflicts with current state'
      }
      if (kind === 'validation_error') {
        return 'the request is invalid'
      }
      if (isIntegrityKind(kind)) {
        return integrityMessage(kind)
      }
      if (kind === 'request_rejected') {
        return 'the request is invalid'
      }
      if (kind === 'response_too_large') {
        return 'protocol response exceeds the size limit'
      }
      if (kind === 'cancelled') {
        return 'request cancelled'
      }
      return 'the Locker operation failed'
  }
}

function integrityMessage(kind: string): string {
  switch (kind) {
    case 'integrity_error':
      return 'stored data failed an integrity check'
    case 'transport_integrity_error':
      return 'transport integrity verification failed'
    case 'data_integrity_error':
    case 'data_error':
      return 'data integrity verification failed'
    default:
      return 'data integrity verification failed'
  }
}
