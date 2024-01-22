import 'mocha'
import { assert } from 'chai'
import { locker } from './mocks'

require('dotenv').config()

/**
 * Test with 106k data
 */

locker.apiBase = process.env.WALLET_EXAMPLE_BASE_API || ''
locker.accessKeyId = process.env.WALLET_EXAMPLE_ACCCESS_KEY_ID || ''
locker.secretAccessKey = process.env.WALLET_EXAMPLE_ACCCESS_KEY_SECRET || ''

describe('Basic actions with large data', function () {
  this.timeout(10000)

  it('get 1 secret', async () => {
    const value = await locker.get('99990_uaxl')
    assert.isString(value)
  })

  it('get 1 invalid secret and expect undefined', async () => {
    const value = await locker.get('invalid')
    assert.equal(value, undefined)
  })

  it('get 1 invalid env and expect error', async () => {
    try {
      await locker.getEnvironment('invalid')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })

  it('list env', async () => {
    const res = await locker.listEnvironments()
    assert.isArray(res)
    assert.isAbove(res.length, 0)
  })

  it('get 1 env', async () => {
    const res = await locker.getEnvironment('prod')
    assert.equal(res.name, 'prod')
  })
})
