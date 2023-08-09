import { Environment, LockerSecret, Secret } from './abstraction'
import * as test from './test'
import { runCommand } from './utils/command'

class Locker implements LockerSecret {
  baseApi: string = 'https://secrets-core.locker.io'
  accessKey: string

  test = test

  constructor() {
    this.accessKey = ''
  }

  async list(): Promise<Secret[]> {
    const res = await runCommand({
      target: 'secret',
      accessKey: this.accessKey,
      apiBase: this.baseApi,
      action: 'list',
    })
    console.log(res)
    return Promise.resolve([])
  }

  async get(key: string): Promise<string> {
    return Promise.resolve(key)
  }

  async create(key: string, value: string): Promise<Secret> {
    return Promise.resolve({})
  }

  async modify(key: string, value: string): Promise<Secret> {
    return Promise.resolve({})
  }

  async listEnvironments(): Promise<Environment[]> {
    return Promise.resolve([])
  }

  async getEnvironment(name: string): Promise<Environment> {
    return Promise.resolve({})
  }

  async createEnvironment(name: string): Promise<Environment> {
    return Promise.resolve({})
  }

  async modifyEnvironment(name: string): Promise<Environment> {
    return Promise.resolve({})
  }
}

export const locker = new Locker()
