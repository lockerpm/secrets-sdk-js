import 'mocha'
import { assert } from 'chai'
import { locker } from './mocks'

require('dotenv').config()

/**
 * Test with invalid access key
 */

const accessKey = process.env.ACCESS_KEY_INVALID || ''
const [accessKeyId, secretAccessKey] = accessKey.split(':')
locker.accessKeyId = accessKeyId
locker.secretAccessKey = secretAccessKey

// Listing
describe('List existing secrets and environments with invalid key', () => {
  it('list secrets and expect error', async () => {
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
    const value = await locker.get('secret 1', undefined, '456')
    assert.equal(value, '456')
  })
})

// Create and update env
describe('Update env with invalid key', () => {
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
