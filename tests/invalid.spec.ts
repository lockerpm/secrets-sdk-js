import 'mocha'
import { assert } from 'chai'
import { locker } from '../index'

require('dotenv').config()

before(() => {
  locker.accessKey = process.env.ACCESS_KEY_INVALID || ''
})

// Listing
describe('List existing secrets and environments with invalid key', () => {
  it('list secrets', async () => {
    let res: any
    try {
      res = await locker.list()
    } catch (e) {
      res = e
    }
    assert.instanceOf(res, Error)
  })

  it('get a secret', async () => {
    const value = await locker.get('secret 1')
    assert.equal(value, undefined)
  })

  it('get a secret with default value', async () => {
    const value = await locker.get('secret 1', undefined, 456)
    assert.equal(value, 456)
  })
})

// Create and update env
describe('Update env with revoked key', () => {
  it('edit environment', async () => {
    let res: any
    const payload = {
      externalUrl: '123123123',
    }
    try {
      res = await locker.modifyEnvironment('test1', payload)
    } catch (e) {
      res = e
    }
    assert.instanceOf(res, Error)
  })
})
