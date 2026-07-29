import {
  LockerObj,
  type EnvironmentData,
  type IEnvironment,
} from '../abstraction/index.js'

export class Environment
  extends LockerObj<EnvironmentData>
  implements IEnvironment
{
  readonly object: string
  readonly id: string
  name: string
  externalUrl: string
  description: string
  readonly creationDate: number
  readonly revisionDate: number
  readonly updatedDate: number | null
  readonly projectId: number

  constructor(obj: EnvironmentData)
  constructor(obj: Record<string, unknown>)
  constructor(obj: Record<string, unknown>) {
    super(obj as EnvironmentData)
    this.object = typeof obj.object === 'string' ? obj.object : 'environment'
    this.id = typeof obj.id === 'string' ? obj.id : ''
    this.name = typeof obj.name === 'string' ? obj.name : ''
    this.externalUrl =
      typeof obj.external_url === 'string' ? obj.external_url : ''
    this.description =
      typeof obj.description === 'string' ? obj.description : ''
    this.creationDate =
      typeof obj.creation_date === 'number' ? obj.creation_date : 0
    this.revisionDate =
      typeof obj.revision_date === 'number' ? obj.revision_date : 0
    this.updatedDate =
      typeof obj.updated_date === 'number' ? obj.updated_date : null
    this.projectId = typeof obj.project_id === 'number' ? obj.project_id : 0
  }

  override toJSON(): EnvironmentData {
    return {
      ...this._raw,
      object: this.object,
      id: this.id,
      name: this.name,
      external_url: this.externalUrl,
      description: this.description,
      creation_date: this.creationDate,
      revision_date: this.revisionDate,
      updated_date: this.updatedDate,
      project_id: this.projectId,
    }
  }
}
