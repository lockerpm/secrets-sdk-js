import 'mocha'
import { assert } from 'chai'
import { Locker } from '../index'
import { LogLevel } from '../src/abstraction'

require('dotenv').config()

const accessKey = process.env.ACCESS_KEY_REVOKED || ''
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
describe('List existing secrets and environments with revoked key', () => {
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
