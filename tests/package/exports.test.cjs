'use strict'

const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

test('CommonJS and ESM exports expose the same public SDK', async () => {
  const commonJS = require('../../lib/cjs/index.js')
  const esm = await import(pathToFileURL(path.resolve('lib/esm/index.js')).href)

  for (const name of [
    'EmptyOutputError',
    'Environment',
    'Locker',
    'LockerNotFoundError',
    'LockerTransportError',
    'Secret',
  ]) {
    assert.equal(typeof commonJS[name], 'function')
    assert.equal(typeof esm[name], 'function')
  }
  for (const name of ['Action', 'Target']) {
    assert.equal(typeof commonJS[name], 'object')
    assert.equal(typeof esm[name], 'object')
  }
  assert.deepEqual(Object.keys(commonJS).sort(), Object.keys(esm).sort())
})

test('legacy resource constructors remain source-compatible', () => {
  const { Environment, Secret } = require('../../lib/cjs/index.js')
  const secret = new Secret({
    key: 'API_KEY',
    value: 'value',
  })
  const environment = new Environment({
    name: 'production',
  })

  assert.equal(secret.key, 'API_KEY')
  assert.equal(secret.value, 'value')
  assert.equal(secret.description, '')
  assert.equal(secret.environmentName, null)
  assert.equal(environment.name, 'production')
  assert.equal(environment.externalUrl, '')
})

test('embedded client version matches package.json', async () => {
  const packageJSON = JSON.parse(
    await readFile(path.resolve('package.json'), 'utf8'),
  )
  const { SDK_VERSION } = require('../../lib/cjs/src/version.js')
  assert.equal(SDK_VERSION, packageJSON.version)
})
