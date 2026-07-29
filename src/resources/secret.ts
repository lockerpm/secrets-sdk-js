import { inspect } from 'node:util'
import {
  LockerObj,
  type ISecret,
  type SecretData,
} from '../abstraction/index.js'

export class Secret extends LockerObj<SecretData> implements ISecret {
  readonly object: string
  readonly id: string
  readonly creationDate: number
  readonly revisionDate: number
  readonly updatedDate: number | null
  readonly deletedDate: number | null
  readonly lastUseDate: number | null
  readonly projectId: number
  readonly environmentId: string | null
  environmentName: string | null
  key: string
  value: string
  description: string

  constructor(obj: SecretData)
  constructor(obj: Record<string, unknown>)
  constructor(obj: Record<string, unknown>) {
    super(obj as SecretData)
    this.object = typeof obj.object === 'string' ? obj.object : 'secret'
    this.id = typeof obj.id === 'string' ? obj.id : ''
    this.creationDate =
      typeof obj.creation_date === 'number' ? obj.creation_date : 0
    this.revisionDate =
      typeof obj.revision_date === 'number' ? obj.revision_date : 0
    this.updatedDate =
      typeof obj.updated_date === 'number' ? obj.updated_date : null
    this.deletedDate =
      typeof obj.deleted_date === 'number' ? obj.deleted_date : null
    this.lastUseDate =
      typeof obj.last_use_date === 'number' ? obj.last_use_date : null
    this.projectId = typeof obj.project_id === 'number' ? obj.project_id : 0
    this.environmentId =
      typeof obj.environment_id === 'string' ? obj.environment_id : null
    this.environmentName =
      typeof obj.environment_name === 'string' ? obj.environment_name : null
    this.key = typeof obj.key === 'string' ? obj.key : ''
    this.value = typeof obj.value === 'string' ? obj.value : ''
    this.description =
      typeof obj.description === 'string' ? obj.description : ''
  }

  override toJSON(): SecretData {
    return {
      ...this._raw,
      object: this.object,
      id: this.id,
      creation_date: this.creationDate,
      revision_date: this.revisionDate,
      updated_date: this.updatedDate,
      deleted_date: this.deletedDate,
      last_use_date: this.lastUseDate,
      project_id: this.projectId,
      environment_id: this.environmentId,
      environment_name: this.environmentName,
      key: this.key,
      value: this.value,
      description: this.description,
    }
  }

  override toString(): string {
    return `Secret { key: ${JSON.stringify(this.key)}, value: [REDACTED] }`
  }

  [inspect.custom](): string {
    return this.toString()
  }
}
