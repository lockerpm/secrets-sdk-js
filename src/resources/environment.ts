import { IEnvironment, LockerObj } from '../abstraction'

export class Environment extends LockerObj implements IEnvironment {
  name: string = ''
  externalUrl: string = ''
  description?: string | undefined = ''

  constructor(obj: { [key: string]: any }) {
    super(obj)
    this.name = this.getValueOrDefault('name')
    this.externalUrl = this.getValueOrDefault('external_url', '')
    this.description = this.getValueOrDefault('description', '')
  }
}
