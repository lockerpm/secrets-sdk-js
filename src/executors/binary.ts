import { CommandParams, Executor } from '../abstraction/executor'
import { execSync, exec } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { camelToSnake } from '../utils/helpers'
import { Logger } from '../utils/logger'

export class BinaryExecutor implements Executor {
  logger: Logger

  _binaryPath: string

  _agent: string

  constructor(logger: Logger) {
    this.logger = logger
    this._binaryPath = this._chooseBinary()
    this._agent = this._getAgent()
    this._grantPermission()
  }

  runCommand(params: CommandParams) {
    return new Promise<string>((resolve, reject) => {
      try {
        const command = `${this._binaryPath} ${this._objToCommand(params)}`
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
      const command = `${this._binaryPath} ${this._objToCommand(params)}`
      const res = execSync(command).toString()
      this.logger.debug(command)
      this.logger.debug(res)
      return res
    } catch (error) {
      throw error
    }
  }

  // -------------------- PRIVATE METHODS --------------------

  private _chooseBinary() {
    const platform = os.platform()
    const dirs = this._getSrcPath()
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

  private _getAgent() {
    const dirs = this._getSrcPath()
    dirs.pop()
    let packageJSONPath = `${dirs.join(path.sep)}${path.sep}package.json`
    const packageJSON = require(packageJSONPath)
    return `NodeJs - ${packageJSON.version}`
  }

  private _getSrcPath() {
    const dirs = __dirname.split(path.sep)
    dirs.pop()
    if (dirs.includes('cjs') || dirs.includes('esm')) {
      dirs.pop()
      dirs.pop()
    }
    return dirs
  }

  private _grantPermission() {
    try {
      try {
        fs.accessSync(this._binaryPath, 0o555)
      } catch (e) {
        fs.chmodSync(this._binaryPath, 0o555)
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
      unsafe,
    } = obj
    let command = `${target} ${action} --access-key-id "${accessKeyId}" --access-key-secret "${accessKeySecret}" --api-base ${apiBase} --agent "${this._agent}" --verbose`
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
    if (unsafe) {
      command += ' --unsafe'
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
