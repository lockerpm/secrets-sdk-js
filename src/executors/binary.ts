import { CommandParams, Executor } from '../abstraction/executor'
import { execFile, execFileSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { camelToSnake } from '../utils/helpers'
import { Logger } from '../utils/logger'

export class BinaryExecutor implements Executor {
  logger: Logger

  private _binaryPath: string
  private _agent: string

  constructor(logger: Logger) {
    this.logger = logger
    this._binaryPath = this._chooseBinary()
    this._agent = this._getAgent()
    this._grantPermission()
  }

  runCommand(params: CommandParams) {
    return new Promise<string>((resolve, reject) => {
      try {
        const { rawCommand, paramsList } = this._objToCommand(params)
        this.logger.debug(rawCommand)
        execFile(this._binaryPath, paramsList, (error, stdout, stderr) => {
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
      const { rawCommand, paramsList } = this._objToCommand(params)
      this.logger.debug(rawCommand)
      const res = execFileSync(this._binaryPath, paramsList).toString()
      this.logger.debug(res)
      return res
    } catch (error) {
      throw error
    }
  }

  // -------------------- PRIVATE METHODS --------------------

  private _chooseBinary() {
    const platform = os.platform()
    const dirs = this._getBasePath()
    let filePath = `${dirs.join(path.sep)}${path.sep}bin${path.sep}`

    switch (platform) {
      case 'darwin':
        filePath += 'locker_secret'
        break
      case 'win32':
        filePath += 'locker_secret.exe'
        break
      default:
        filePath += 'locker_secret'
    }
    return filePath
  }

  private _getAgent() {
    const dirs = this._getBasePath()
    if (dirs.includes('lib')) {
      dirs.pop()
    }
    let packageJSONPath = `${dirs.join(path.sep)}${path.sep}package.json`
    const packageJSON = require(packageJSONPath)
    return `NodeJs - ${packageJSON.version}`
  }

  private _getBasePath() {
    const dirs = __dirname.split(path.sep)
    dirs.pop()
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
      secretAccessKey,
      apiBase,
      target,
      action,
      name,
      env,
      data,
      headers,
      unsafe,
    } = obj
    // Raw command
    let command = `${target} ${action} --access-key-id "${accessKeyId}" --secret-access-key "${secretAccessKey}" --api-base ${apiBase} --agent "${this._agent}" --verbose`

    // Params list broken from raw command
    const paramsList = [
      target,
      action,
      '--access-key-id',
      accessKeyId,
      '--secret-access-key',
      secretAccessKey,
      '--api-base',
      apiBase,
      '--agent',
      this._agent,
      '--verbose',
    ]

    if (name) {
      command += ` --name "${name}"`
      paramsList.push('--name', name)
    }
    if (env) {
      command += ` --env "${env}"`
      paramsList.push('--env', env)
    }
    if (data) {
      const dataString = JSON.stringify(camelToSnake(data))
      command += ` --data ${JSON.stringify(dataString)}`
      paramsList.push('--data', dataString)
    }
    if (unsafe) {
      command += ' --unsafe'
      paramsList.push('--unsafe')
    }
    if (headers) {
      if (typeof headers !== 'object') {
        throw Error('Invalid headers')
      }
      const headersString = Object.entries(headers)
        .map((item) => `${item[0]}:${item[1]}`)
        .join(',')
      command += ` --headers "${headersString}"`
      paramsList.push('--headers', headersString)
    }
    return { rawCommand: command, paramsList }
  }
}
