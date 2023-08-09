import { execSync, exec } from 'child_process'
import os from 'os'

const coreTest = () => {
  const platform = os.platform()
  console.log(platform)
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

  const command = `chmod +x ${filePath} && ${filePath}`
  try {
    const res = execSync(command).toString()
    console.log(res)
  } catch (error) {
    throw error
  }
}

export { coreTest }
