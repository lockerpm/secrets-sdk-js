import { exec } from 'child_process'
import os from 'os'

const getHeight = (value: number) => {
  return new Promise((resolve, reject) => {
    const platform = os.platform()
    console.log(platform)
    let filePath = ''

    switch (platform) {
      case 'darwin':
        filePath = './bin/height_mac'
        break
      case 'win32':
        filePath = './bin/height_win.exe'
        break
      default:
        filePath = './bin/height_linux'
    }

    const command = `chmod +x ${filePath} && ${filePath} height ${value}`

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`)
        reject(error)
        return
      }

      console.log('Standard Output:', stdout)
      console.error('Standard Error:', stderr)
      resolve(stdout)
    })
  })
}

export { getHeight }
