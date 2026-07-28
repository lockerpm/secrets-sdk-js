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
  RATE_LIMITED: -32029,
  NETWORK: -32050,
  SERVER: -32051,
  STORAGE: -32060,
} as const

export type LockerErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
export type RequestID = string | number

export type LockerErrorDetails = {
  code: number
  kind: string
  retryable: boolean
  requestId: RequestID
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

  constructor(message: string, details: LockerErrorDetails) {
    super(message)
    this.name = 'LockerError'
    this.code = details.code
    this.kind = details.kind
    this.retryable = details.retryable
    this.requestId = details.requestId
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

export function errorFromResponse(
  code: number,
  message: string,
  kind: string,
  retryable: boolean,
  requestId: RequestID,
): LockerError {
  const details = { code, kind, retryable, requestId }
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
