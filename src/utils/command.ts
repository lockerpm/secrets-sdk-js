import { execSync, exec } from 'child_process'
import os from 'os'
import path from 'path'

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
  data?: { [key: string]: any }
}

export const runCommand = (params: CommandParams) => {
  return new Promise<string>((resolve, reject) => {
    try {
      const binaryPath = chooseBinary()
      const command = `chmod +x ${binaryPath} && ${binaryPath} ${objToCommand(
        params
      )}`
      exec(command, (error, stdout, stderr) => {
        // console.log(command)
        // console.log(stderr || stdout)
        if (error) {
          reject(stderr || stdout)
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
  const dirs = __dirname.split(path.sep)
  dirs.pop()
  let filePath = `${dirs.join(path.sep)}${path.sep}bin${path.sep}`

  switch (platform) {
    case 'darwin':
      filePath += 'locker_secret_mac'
      break
    case 'win32':
      filePath += 'locker_secret_win.exe'
      break
    default:
      filePath += 'locker_secret_linux'
  }
  return filePath
}

const objToCommand = (obj: CommandParams) => {
  const { accessKey, apiBase, target, action, id, env, data } = obj
  let command = `${target} ${action} --access-key "${accessKey}" --api-base ${apiBase}`
  if (id) {
    command += ` --id "${id}"`
  }
  if (env) {
    command += ` --env "${env}"`
  }
  if (data) {
    const dataString = JSON.stringify(JSON.stringify(camelToSnake(data)))
    command += ` --data ${dataString}`
  }
  return command
}

function camelToSnake(obj: { [key: string]: any }) {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }
  const snakeCaseObject: { [key: string]: any } = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const snakeKey = key.replace(
        /[A-Z]/g,
        (match) => `_${match.toLowerCase()}`
      )
      snakeCaseObject[snakeKey] = camelToSnake(obj[key])
    }
  }
  return snakeCaseObject
}
