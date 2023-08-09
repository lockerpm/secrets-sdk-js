import { ISecret, LockerObj } from '../abstraction'

export class Secret extends LockerObj implements ISecret {
  key: string
  value: string
  description?: string | undefined
  environmentId?: string
  environmentName?: string

  constructor(obj: { [key: string]: any }) {
    super(obj)
    this.key = this.getValueOrDefault('key')
    this.value = this.getValueOrDefault('value')
    this.description = this.getValueOrDefault('description', '')
    this.environmentId = this.getValueOrDefault('environment_id', '')
    this.environmentName = this.getValueOrDefault('environment_name', '')
  }
}
