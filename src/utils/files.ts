import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExportFormat } from '../abstraction/executor.js'
import type { Secret } from '../resources/secret.js'

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function envAssignment(key: string, value: string): string {
  if (!ENVIRONMENT_KEY.test(key)) {
    throw new Error(
      `Secret key ${JSON.stringify(key)} cannot be exported as dotenv`,
    )
  }
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`')
    .replaceAll('!', '\\!')
  return `${key}="${escaped}"`
}

function textAssignment(key: string, value: string): string {
  if (key.includes('\n') || key.includes('\r')) {
    return `${JSON.stringify(key)}=${JSON.stringify(value)}`
  }
  if (value.includes('\n') || value.includes('\r')) {
    return `${key}=${JSON.stringify(value)}`
  }
  return `${key}=${value}`
}

export function formatSecrets(
  secrets: readonly Secret[],
  format: ExportFormat,
): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(
        secrets.map((secret) => secret.toJSON()),
        null,
        2,
      )}\n`
    case 'env':
      return `${secrets
        .map((secret) => envAssignment(secret.key, secret.value))
        .join('\n')}\n`
    case 'txt':
      return `${secrets
        .map((secret) => textAssignment(secret.key, secret.value))
        .join('\n')}\n`
  }
}

export async function writePrivateFileAtomically(
  outputPath: string,
  contents: string,
): Promise<void> {
  const resolved = path.resolve(outputPath)
  const temporary = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.locker-${randomUUID()}`,
  )

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(temporary, resolved)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
    }
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function readUTF8FileBounded(
  inputPath: string,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive safe integer')
  }

  const handle = await fs.open(inputPath, 'r')
  const buffer = Buffer.allocUnsafe(maxBytes + 1)
  let offset = 0
  try {
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      )
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    if (offset > maxBytes) {
      throw new Error(`input file exceeds ${maxBytes} bytes`)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, offset),
    )
  } finally {
    buffer.fill(0)
    await handle.close()
  }
}
