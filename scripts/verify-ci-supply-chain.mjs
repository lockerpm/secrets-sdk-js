import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const images = [
  'node:22.23.1-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
  'node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd',
]
const developmentImage = images[1]
const maxInputBytes = 2 * 1024 * 1024
const forbiddenBootstrap = /\b(?:apt-get|apk\s+add|curl|wget)\b/iu

async function readBounded(relativePath) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a regular non-link file`)
  }
  const bytes = await readFile(absolutePath)
  if (bytes.length === 0 || bytes.length > maxInputBytes) {
    throw new Error(`${relativePath} is empty or exceeds its input bound`)
  }
  return bytes.toString('utf8')
}

function verifyLock(lock) {
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2) {
    throw new Error(
      'package-lock.json must use an integrity-capable lock format',
    )
  }
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json is missing its packages graph')
  }

  for (const [name, metadata] of Object.entries(lock.packages)) {
    if (name === '' || metadata.link === true) {
      continue
    }
    if (
      typeof metadata.version !== 'string' ||
      typeof metadata.resolved !== 'string' ||
      !metadata.resolved.startsWith('https://registry.npmjs.org/') ||
      typeof metadata.integrity !== 'string' ||
      !metadata.integrity.startsWith('sha512-')
    ) {
      throw new Error(
        `${name} is not locked to an npm artifact with SHA-512 integrity`,
      )
    }
  }
}

async function main() {
  const [pipeline, dockerfile, packageText, lockText] = await Promise.all([
    readBounded('.gitlab-ci.yml'),
    readBounded('Dockerfile'),
    readBounded('package.json'),
    readBounded('package-lock.json'),
  ])

  if (
    images.some((image) => !pipeline.includes(image)) ||
    !dockerfile.includes(developmentImage)
  ) {
    throw new Error(
      'CI and Dockerfile must use the reviewed immutable Node LTS images',
    )
  }
  if (
    forbiddenBootstrap.test(pipeline) ||
    forbiddenBootstrap.test(dockerfile)
  ) {
    throw new Error(
      'CI and Dockerfile must not bootstrap tools through OS package downloads',
    )
  }
  if (
    !pipeline.includes('npm ci --ignore-scripts') ||
    !pipeline.includes('npm audit')
  ) {
    throw new Error(
      'CI must use npm ci with disabled install scripts and run an audit gate',
    )
  }
  if (!pipeline.includes('LOCKER_CLI_RELEASE_PUBLIC_KEY')) {
    throw new Error(
      'release verification must require an independent trust root',
    )
  }

  const packageJson = JSON.parse(packageText)
  if (packageJson.engines?.node !== '^22.20.0 || ^24.0.0') {
    throw new Error(
      'package metadata must reject end-of-life Node.js release lines',
    )
  }
  verifyLock(JSON.parse(lockText))
}

await main()
