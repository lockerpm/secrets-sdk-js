import { exec } from 'child_process'
import os from 'os'
import fs from 'fs'

type Params = {
  settings?: {
    height: number
  }
  settingsFilePath?: string
}

const getHeight = (params: Params) => {
  const { settings, settingsFilePath } = params
  let value: number

  if (settings) {
    value = settings.height
  } else if (settingsFilePath) {
    const s = getJSONContent(settingsFilePath)
    if (s) {
      value = s.height
    } else {
      throw Error('File not valid')
    }
  } else {
    throw Error('No settings or file found')
  }

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

function getJSONContent(filePath: string) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const content = JSON.parse(fileContent)
    return content
  } catch (error) {
    return null
  }
}
