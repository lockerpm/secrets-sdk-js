'use strict'

const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const mode = process.argv[2]

switch (mode) {
  case 'environment':
    process.stdout.write(
      JSON.stringify({
        lockerAccessKeyId: process.env.LOCKER_ACCESS_KEY_ID,
        lockerSecretAccessKey: process.env.LOCKER_SECRET_ACCESS_KEY,
        legacyAccessKeyId: process.env.locker_access_key_id,
        legacySecretAccessKey: process.env.locker_secret_access_key,
        nodeOptions: process.env.NODE_OPTIONS,
        pathPresent: typeof process.env.PATH === 'string',
      }),
    )
    break
  case 'large':
    process.stdout.write('x'.repeat(64 * 1024))
    break
  case 'invalid-utf8':
    process.stdout.write(Buffer.from([0xc3, 0x28]))
    break
  case 'hang':
    setInterval(() => undefined, 1000)
    break
  case 'tree-hang': {
    const child = spawn(process.execPath, [__filename, 'hang'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    writeFileSync(process.argv[3], String(child.pid), 'utf8')
    setInterval(() => undefined, 1000)
    break
  }
  case 'tree-exit': {
    const child = spawn(process.execPath, [__filename, 'hang'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    writeFileSync(process.argv[3], String(child.pid), 'utf8')
    process.stdout.write('{}')
    break
  }
  default:
    process.exitCode = 2
}
