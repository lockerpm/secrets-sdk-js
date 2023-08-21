import { CommandParams, Executor } from '../abstraction/executor'
import { execSync, exec } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { camelToSnake } from '../utils/helpers'
import { LogLevel } from '../abstraction'

export class BinaryExecutor implements Executor {
  binaryPath: string
  logLevel: LogLevel

  constructor() {
    this.binaryPath = this._chooseBinary()
    this.logLevel = LogLevel.ERROR
    this._grantPermission()
  }

  setLogLevel(level: LogLevel) {
    this.logLevel = level
  }

  runCommand(params: CommandParams) {
    return new Promise<string>((resolve, reject) => {
      try {
        const command = `${this.binaryPath} ${this._objToCommand(params)}`
        exec(command, (error, stdout, stderr) => {
          if (this.logLevel >= LogLevel.DEBUG) {
            console.log(command)
            console.log(stderr || stdout)
          }
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

  runCommandSync(params: CommandParams) {
    try {
      const command = `${this.binaryPath} ${this._objToCommand(params)}`
      const res = execSync(command).toString()
      if (this.logLevel >= LogLevel.DEBUG) {
        console.log(command)
        console.log(res)
      }
      return res
    } catch (error) {
      throw error
    }
  }

  private _chooseBinary() {
    const platform = os.platform()
    const dirs = __dirname.split(path.sep)
    dirs.pop()
    if (dirs.includes('cjs') || dirs.includes('esm')) {
      dirs.pop()
      dirs.pop()
    }
    let filePath = `${dirs.join(path.sep)}${path.sep}bin${path.sep}`

    switch (platform) {
      case 'darwin':
        filePath += 'locker_secret_mac'
        break
      case 'win32':
        filePath += 'locker_secret.exe'
        break
      default:
        filePath += 'locker_secret_linux'
    }
    return filePath
  }

  private _grantPermission() {
    try {
      try {
        fs.accessSync(this.binaryPath, fs.constants.X_OK)
      } catch (e) {
        fs.chmodSync(this.binaryPath, fs.constants.X_OK)
      }
    } catch (error) {
      if (this.logLevel >= LogLevel.DEBUG) {
        console.log(error)
      }
      throw Error('Cannot grant execute permission for binary')
    }
  }

  private _objToCommand = (obj: CommandParams) => {
    const { accessKey, apiBase, target, action, id, env, data, headers } = obj
    let command = `${target} ${action} --access-key "${accessKey}" --api-base ${apiBase} --client nodejs`
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
    if (headers) {
      if (typeof headers !== 'object') {
        throw Error('Invalid headers')
      }
      const headersString = Object.entries(headers)
        .map((item) => `${item[0]}:${item[1]}`)
        .join(',')
      command += ` --headers "${headersString}"`
    }
    return command
  }
}
