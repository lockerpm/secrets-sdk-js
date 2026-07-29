import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const modulePathSentinel = "'__LOCKER_COMPILED_MODULE_PATH__'"
const moduleFormatSentinel = "'__LOCKER_COMPILED_MODULE_FORMAT__'"
const tsc = fileURLToPath(
  new URL('../node_modules/typescript/bin/tsc', import.meta.url),
)

await rm(new URL('lib', root), { force: true, recursive: true })

for (const config of [
  'configs/tsconfig.esm.json',
  'configs/tsconfig.cjs.json',
]) {
  const result = spawnSync(process.execPath, [tsc, '-p', config], {
    cwd: fileURLToPath(root),
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

for (const [format, replacement] of [
  ['esm', 'fileURLToPath(import.meta.url)'],
  ['cjs', '__filename'],
]) {
  const resolver = new URL(`lib/${format}/src/cli/resolver.js`, root)
  const output = await readFile(resolver, 'utf8')
  const pathOccurrences = output.split(modulePathSentinel).length - 1
  const formatOccurrences = output.split(moduleFormatSentinel).length - 1
  if (pathOccurrences !== 1 || formatOccurrences !== 1) {
    throw new Error(
      `Expected exactly one Locker module sentinel in ${resolver.pathname}`,
    )
  }
  let patched = output
    .replace(modulePathSentinel, replacement)
    .replace(moduleFormatSentinel, `'${format}'`)
  if (format === 'esm') {
    patched = `import { fileURLToPath } from 'node:url'\n${patched}`
  }
  await writeFile(resolver, patched, 'utf8')
}

await mkdir(new URL('lib/esm', root), { recursive: true })
await mkdir(new URL('lib/cjs', root), { recursive: true })
await writeFile(
  new URL('lib/esm/package.json', root),
  '{"type":"module"}\n',
  'utf8',
)
await writeFile(
  new URL('lib/cjs/package.json', root),
  '{"type":"commonjs"}\n',
  'utf8',
)
