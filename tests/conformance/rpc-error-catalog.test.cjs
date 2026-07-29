'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  LockerAlreadyExistsError,
  LockerAuthenticationError,
  LockerConflictError,
  LockerError,
  LockerIntegrityError,
  LockerNetworkError,
  LockerNotFoundError,
  LockerOperationCancelledError,
  LockerPermissionError,
  LockerProtocolError,
  LockerRateLimitError,
  LockerRequestRejectedError,
  LockerResponseTooLargeError,
  LockerServerError,
  LockerStorageError,
  LockerValidationError,
  errorFromResponse,
} = require('../../lib/cjs/index.js')

const CATALOG_SHA256 =
  '631ac21d6add27f7bac24e889fc565ca4cdb790c45ee4068c489481ca58594f5'

test('vendored RPC catalog matches runtime error mapping', () => {
  const raw = readFileSync(
    path.resolve(__dirname, '../../protocol/locker-rpc-errors.v1.json'),
  )
  assert.equal(createHash('sha256').update(raw).digest('hex'), CATALOG_SHA256)
  const catalog = JSON.parse(raw.toString('utf8'))
  const types = {
    ProtocolError: LockerProtocolError,
    OperationError: LockerError,
    OperationCancelledError: LockerOperationCancelledError,
    RequestRejectedError: LockerRequestRejectedError,
    ResponseTooLargeError: LockerResponseTooLargeError,
    ConflictError: LockerConflictError,
    AlreadyExistsError: LockerAlreadyExistsError,
    ValidationError: LockerValidationError,
    AuthenticationError: LockerAuthenticationError,
    PermissionDeniedError: LockerPermissionError,
    NotFoundError: LockerNotFoundError,
    RateLimitError: LockerRateLimitError,
    NetworkError: LockerNetworkError,
    ServerError: LockerServerError,
    StorageError: LockerStorageError,
    IntegrityError: LockerIntegrityError,
  }

  for (const catalogError of catalog.errors) {
    const mapped = errorFromResponse(
      catalogError.rpc_code,
      'untrusted catalog fixture message',
      catalogError.kind,
      catalogError.retryable,
      'request-catalog',
    )
    assert.equal(mapped.constructor, types[catalogError.sdk_error])
    assert.equal(mapped.message, catalogError.message)
    assert.equal(mapped.retryable, catalogError.retryable)
  }

  const policy = catalog.unknown_server_code_policy
  const unknown = errorFromResponse(
    policy.minimum,
    'untrusted future error',
    'future_error',
    policy.preserve_retryable,
    'request-unknown',
  )
  assert.equal(unknown.constructor, LockerError)
  assert.equal(unknown.message, policy.message)
  assert.equal(unknown.retryable, policy.preserve_retryable)
})
