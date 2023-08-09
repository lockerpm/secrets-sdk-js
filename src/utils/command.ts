import { execSync, exec } from 'child_process'
import os from 'os'

type CommandParams = {
  target: 'environment' | 'secret'
  accessKey: string
  apiBase: string
  action: 'create' | 'get' | 'list' | 'update'
}

export const runCommand = (params: CommandParams) => {
  return new Promise((resolve, reject) => {
    try {
      const binaryPath = chooseBinary()
      const command = `chmod +x ${binaryPath} && ${binaryPath} ${objToCommand(
        params
      )}`
      console.log(command)
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.log(123)
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
  const { accessKey, apiBase, target, action } = obj
  let command = `${target} ${action} --access-key "${accessKey}" --api-base ${apiBase}`
  return command
}
