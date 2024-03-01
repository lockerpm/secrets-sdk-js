import 'mocha'
import { assert } from 'chai'
import { Secret } from '../../src/resources'
import { locker } from '../mocks'

require('dotenv').config()

/**
 * Test with readonly access key
 */

const accessKey = process.env.ACCESS_KEY_READ_ONLY || ''
const [accessKeyId, secretAccessKey] = accessKey.split(':')
locker.accessKeyId = accessKeyId
locker.secretAccessKey = secretAccessKey

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
    const value = await locker.get(
      'a key that not yet created',
      undefined,
      '123'
    )
    assert.equal(value, '123')
  })
})

// Create and update env
describe('Update env with readonly key', () => {
  it('edit environment and expect error', async () => {
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
