import type {
  EnvironmentData,
  IEnvironmentPage,
  ISecretPage,
  SecretData,
} from '../abstraction/index.js'
import { Environment, Secret } from '../resources/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== 'string') {
    throw new TypeError(`Locker response field ${field} must be a string`)
  }
  return value[field] as string
}

function requireNumber(value: Record<string, unknown>, field: string): number {
  if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
    throw new TypeError(`Locker response field ${field} must be a number`)
  }
  return value[field] as number
}

function requireInteger(value: Record<string, unknown>, field: string): number {
  const fieldValue = requireNumber(value, field)
  if (!Number.isSafeInteger(fieldValue)) {
    throw new TypeError(`Locker response field ${field} must be an integer`)
  }
  return fieldValue
}

function requireNullableString(
  value: Record<string, unknown>,
  field: string,
): string | null {
  const fieldValue = value[field]
  if (fieldValue !== null && typeof fieldValue !== 'string') {
    throw new TypeError(
      `Locker response field ${field} must be a string or null`,
    )
  }
  return fieldValue
}

function requireNullableNumber(
  value: Record<string, unknown>,
  field: string,
): number | null {
  const fieldValue = value[field]
  if (
    fieldValue !== null &&
    (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))
  ) {
    throw new TypeError(
      `Locker response field ${field} must be a number or null`,
    )
  }
  return fieldValue
}

function secretData(value: unknown): SecretData {
  if (!isRecord(value)) {
    throw new TypeError('Locker secret response must be an object')
  }
  if ('secret_hash' in value || 'environment_hash' in value) {
    throw new TypeError('Locker secret response exposes internal hash fields')
  }
  const object = requireString(value, 'object')
  if (object !== 'secret') {
    throw new TypeError('Locker secret response has an invalid object type')
  }
  return {
    ...value,
    object,
    id: requireString(value, 'id'),
    creation_date: requireNumber(value, 'creation_date'),
    revision_date: requireNumber(value, 'revision_date'),
    updated_date: requireNullableNumber(value, 'updated_date'),
    deleted_date: requireNullableNumber(value, 'deleted_date'),
    last_use_date: requireNullableNumber(value, 'last_use_date'),
    project_id: requireInteger(value, 'project_id'),
    environment_id: requireNullableString(value, 'environment_id'),
    environment_name: requireNullableString(value, 'environment_name'),
    key: requireString(value, 'key'),
    value: requireString(value, 'value'),
    description: requireString(value, 'description'),
  }
}

function environmentData(value: unknown): EnvironmentData {
  if (!isRecord(value)) {
    throw new TypeError('Locker environment response must be an object')
  }
  if ('environment_hash' in value) {
    throw new TypeError(
      'Locker environment response exposes an internal hash field',
    )
  }
  const object = requireString(value, 'object')
  if (object !== 'environment') {
    throw new TypeError(
      'Locker environment response has an invalid object type',
    )
  }
  return {
    ...value,
    object,
    id: requireString(value, 'id'),
    name: requireString(value, 'name'),
    external_url: requireString(value, 'external_url'),
    description: requireString(value, 'description'),
    creation_date: requireNumber(value, 'creation_date'),
    revision_date: requireNumber(value, 'revision_date'),
    updated_date: requireNullableNumber(value, 'updated_date'),
    project_id: requireInteger(value, 'project_id'),
  }
}

function pageData(
  value: unknown,
  expectedObject: 'secret_page' | 'environment_page',
): Record<string, unknown> {
  if (!isRecord(value) || value.object !== expectedObject) {
    throw new TypeError('Locker page response has an invalid object type')
  }
  if (!Array.isArray(value.items) || value.items.length > 1000) {
    throw new TypeError('Locker page response has invalid items')
  }
  if (
    value.next_cursor !== null &&
    (typeof value.next_cursor !== 'string' ||
      value.next_cursor.length === 0 ||
      Buffer.byteLength(value.next_cursor, 'utf8') > 4096)
  ) {
    throw new TypeError('Locker page response has an invalid cursor')
  }
  return value
}

export class Converter {
  static toSecrets(value: unknown): Secret[] {
    if (!Array.isArray(value)) {
      throw new TypeError('Locker secrets response must be an array')
    }
    return value.map((item) => new Secret(secretData(item)))
  }

  static toSecret(value: unknown): Secret {
    return new Secret(secretData(value))
  }

  static toEnvironments(value: unknown): Environment[] {
    if (!Array.isArray(value)) {
      throw new TypeError('Locker environments response must be an array')
    }
    return value.map((item) => new Environment(environmentData(item)))
  }

  static toEnvironment(value: unknown): Environment {
    return new Environment(environmentData(value))
  }

  static toSecretPage(value: unknown): ISecretPage {
    const page = pageData(value, 'secret_page')
    return Object.freeze({
      object: 'secret_page' as const,
      items: Object.freeze(this.toSecrets(page.items)),
      nextCursor: page.next_cursor as string | null,
    })
  }

  static toEnvironmentPage(value: unknown): IEnvironmentPage {
    const page = pageData(value, 'environment_page')
    return Object.freeze({
      object: 'environment_page' as const,
      items: Object.freeze(this.toEnvironments(page.items)),
      nextCursor: page.next_cursor as string | null,
    })
  }
}
