import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
const versionFile = fileURLToPath(new URL('../src/version.ts', import.meta.url))

const packageJSON = JSON.parse(await readFile(packageFile, 'utf8'))
if (!versionPattern.test(packageJSON.version)) {
  throw new Error(`package.json version is invalid: ${packageJSON.version}`)
}

const versionSource = await readFile(versionFile, 'utf8')
const matches = versionSource.match(/export const SDK_VERSION = '[^']+'/gu)
if (matches?.length !== 1) {
  throw new Error('SDK version source does not have one canonical field')
}

await writeFile(
  versionFile,
  versionSource.replace(
    /export const SDK_VERSION = '[^']+'/u,
    `export const SDK_VERSION = '${packageJSON.version}'`,
  ),
)

process.stdout.write(`synced SDK_VERSION to ${packageJSON.version}\n`)
