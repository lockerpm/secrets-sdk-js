export interface LockerSecret {
  baseApi: string
  accessKey: string
  list: () => Promise<Secret[]>
  get: (key: string) => Promise<string>
  create: (key: string, value: string) => Promise<Secret>
  modify: (key: string, value: string) => Promise<Secret>
  listEnvironments: () => Promise<Environment[]>
  getEnvironment: (name: string) => Promise<Environment>
  createEnvironment: (name: string) => Promise<Environment>
  modifyEnvironment: (name: string) => Promise<Environment>
}

export abstract class Secret {
  key?: string
  value?: string
  description?: string
  environment?: Environment
}

export abstract class Environment {
  name?: string
  externalUrl?: string
  description?: string
}
