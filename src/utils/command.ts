import { execSync, exec } from 'child_process'
import os from 'os'

export enum Target {
  ENVIRONMENT = 'environment',
  SECRET = 'secret',
}

export enum Action {
  CREATE = 'create',
  GET = 'get',
  LIST = 'list',
  UPDATE = 'update',
}

export type CommandParams = {
  target: Target
  action: Action
  accessKey: string
  apiBase: string
  id?: string // Key name
  env?: string
}

export const runCommand = (params: CommandParams) => {
  return new Promise<string>((resolve, reject) => {
    try {
      const binaryPath = chooseBinary()
      const command = `chmod +x ${binaryPath} && ${binaryPath} ${objToCommand(
        params
      )}`
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.log(error)
          reject(stderr)
          return
        }
        resolve(stdout)
      })
    } catch (error) {
      reject(error)
    }
  })
}

export const runCommandSync = (params: CommandParams) => {
  try {
    const binaryPath = chooseBinary()
    const command = `chmod +x ${binaryPath} && ${binaryPath} ${objToCommand(
      params
    )}`
    const res = execSync(command).toString()
    return res
  } catch (error) {
    throw error
  }
}

const chooseBinary = () => {
  const platform = os.platform()
  let filePath = ''

  switch (platform) {
    case 'darwin':
      filePath = './src/bin/locker_secret_mac'
      break
    case 'win32':
      filePath = './src/bin/locker_secret_win.exe'
      break
    default:
      filePath = './src/bin/locker_secret_linux'
  }
  return filePath
}

const objToCommand = (obj: CommandParams) => {
  const { accessKey, apiBase, target, action, id, env } = obj
  let command = `${target} ${action} --access-key "${accessKey}" --api-base ${apiBase}`
  if (id) {
    command += ` --id "${id}"`
  }
  if (env) {
    command += ` --env "${env}"`
  }
  return command
}
