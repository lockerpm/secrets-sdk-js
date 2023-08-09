import 'mocha'
import { assert } from 'chai'
import { locker } from '../index'
import { Secret } from '../src/resources'

require('dotenv').config()

before(() => {
  locker.accessKey = process.env.ACCESS_KEY_READ_ONLY || ''
})

// Listing
describe('List existing secrets and environments with readonly key', () => {
  let testSecret: Secret

  it('list secrets', async () => {
    const secrets = await locker.list()
    assert.isArray(secrets)
    assert.isNotEmpty(secrets)
    assert.instanceOf(secrets[0], Secret)
    testSecret = secrets[0]
  })

  it('get 1 secret', async () => {
    const value = await locker.get(testSecret.key)
    assert.equal(value, testSecret.value)
  })

  it('get invalid secret', async () => {
    const value = await locker.get('a key that not yet created')
    assert.equal(value, undefined)
  })

  it('get invalid secret with default value', async () => {
    const value = await locker.get('a key that not yet created', undefined, 123)
    assert.equal(value, 123)
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
