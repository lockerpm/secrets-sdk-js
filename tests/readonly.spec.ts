import 'mocha'
import { assert } from 'chai'
import { Locker } from '../index'
import { Secret } from '../src/resources'
import { LogLevel } from '../src/abstraction'

require('dotenv').config()

/**
 * Test with readonly access key
 */

const accessKey = process.env.ACCESS_KEY_READ_ONLY || ''
const [accessKeyId, accessKeySecret] = accessKey.split(':')
const locker = new Locker({
  accessKeyId,
  accessKeySecret,
  headers: {
    'cf-access-client-id': process.env.CF_ACCESS_CLIENT_ID || '',
    'cf-access-client-secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
  },
  logLevel: LogLevel.ERROR,
})
// Listing
describe('List existing secrets and environments with readonly key', function () {
  this.timeout(10000)

  let testSecret: Secret

  it('list secrets', async () => {
    const secrets = await locker.list()
    assert.isArray(secrets)
    assert.isNotEmpty(secrets)
    assert.instanceOf(secrets[0], Secret)
    testSecret = secrets[0]
  })

  it('get 1 secret', async () => {
    const value = await locker.get(testSecret.key, testSecret.environmentName)
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
describe('Update env with readonly key', () => {
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
