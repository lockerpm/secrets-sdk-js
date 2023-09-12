import { CommandParams, Executor } from '../abstraction/executor'
import { execSync, exec } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { camelToSnake } from '../utils/helpers'
import { Logger } from '../utils/logger'

export class BinaryExecutor implements Executor {
  binaryPath: string
  logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
    this.binaryPath = this._chooseBinary()
    this._grantPermission()
  }

  runCommand(params: CommandParams) {
    return new Promise<string>((resolve, reject) => {
      try {
        const command = `${this.binaryPath} ${this._objToCommand(params)}`
        exec(command, (error, stdout, stderr) => {
          this.logger.debug(command)
          this.logger.debug(stderr || stdout)
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
      this.logger.debug(command)
      this.logger.debug(res)
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
        fs.accessSync(this.binaryPath, 111)
      } catch (e) {
        fs.chmodSync(this.binaryPath, 111)
      }
    } catch (error) {
      this.logger.error(error)
      throw Error('Cannot grant execute permission for binary')
    }
  }

  private _objToCommand = (obj: CommandParams) => {
    const {
      accessKeyId,
      accessKeySecret,
      apiBase,
      target,
      action,
      name,
      env,
      data,
      headers,
    } = obj
    // TODO: replace with SDK version
    const agent = `NodeJS - ${process.versions.node}`
    let command = `${target} ${action} --access-key-id "${accessKeyId}" --access-key-secret "${accessKeySecret}" --api-base ${apiBase} --agent "${agent}" --verbose`
    if (name) {
      command += ` --name "${name}"`
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
