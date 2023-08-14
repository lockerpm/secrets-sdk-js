import { CommandParams, Executor } from '../abstraction/executor'
import { execSync, exec } from 'child_process'
import os from 'os'
import path from 'path'
import { camelToSnake } from '../utils/helpers'

export class BinaryExecutor implements Executor {
  binaryPath: string

  constructor() {
    this.binaryPath = this._chooseBinary()
  }

  runCommand(params: CommandParams) {
    return new Promise<string>((resolve, reject) => {
      try {
        const command = `chmod +x ${this.binaryPath} && ${
          this.binaryPath
        } ${this._objToCommand(params)}`
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

  runCommandSync(params: CommandParams) {
    try {
      const command = `chmod +x ${this.binaryPath} && ${
        this.binaryPath
      } ${this._objToCommand(params)}`
      const res = execSync(command).toString()
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
        filePath += 'locker_secret_win.exe'
        break
      default:
        filePath += 'locker_secret_linux'
    }
    return filePath
  }

  private _objToCommand = (obj: CommandParams) => {
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
}
