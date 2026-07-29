#!/usr/bin/env node

'use strict'

import('./scripts/install-cli.mjs')
  .then(({ installManagedCLI }) => installManagedCLI({ forceCheck: true }))
  .then((result) => {
    process.stdout.write(`${result.message}\n`)
  })
  .catch((error) => {
    const message =
      error instanceof Error ? error.message : 'unknown installer error'
    process.stderr.write(`Locker CLI installation failed: ${message}\n`)
    process.exitCode = 1
  })
