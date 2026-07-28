import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const testRoot = new URL('tests/', root)

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const location = new URL(
      `${entry.name}${entry.isDirectory() ? '/' : ''}`,
      directory,
    )
    if (entry.isDirectory()) {
      files.push(...(await discover(location)))
    } else if (entry.name.endsWith('.test.cjs')) {
      files.push(fileURLToPath(location))
    }
  }
  return files
}

const files = (await discover(testRoot)).sort()
if (files.length === 0) {
  throw new Error('No test files found')
}

// Run test files in separate processes and in a stable order. The release
// verifier intentionally exercises `npm pack`, whose prepack hook rebuilds
// `lib`; running another file against that shared tree at the same time makes
// the suite timing-dependent even though each individual test is hermetic.
for (const file of files) {
  const result = spawnSync(process.execPath, ['--test', file], {
    cwd: fileURLToPath(root),
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
