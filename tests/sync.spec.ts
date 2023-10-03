import 'mocha'
import { assert } from 'chai'
import { Locker } from '../index'
import { Secret, Environment } from '../src/resources'
import { LogLevel } from '../src/abstraction'

require('dotenv').config()

/**
 * Test synchronized functions
 */

const accessKey = process.env.ACCESS_KEY || ''
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
describe('List existing secrets and environments using synchronized method', function () {
  this.timeout(10000)

  let testSecret: Secret
  let testEnv: Environment

  it('list secrets', () => {
    const secrets = locker.listSync()
    assert.isArray(secrets)
    assert.isNotEmpty(secrets)
    assert.instanceOf(secrets[0], Secret)
    testSecret = secrets[0]
  })

  it('list environments', () => {
    const environments = locker.listEnvironmentsSync()
    assert.isArray(environments)
    assert.isNotEmpty(environments)
    assert.instanceOf(environments[0], Environment)
    testEnv = environments[0]
  })

  it('get 1 secret', () => {
    const value = locker.getSync(testSecret.key, testSecret.environmentName)
    assert.equal(value, testSecret.value)
  })

  it('get invalid secret', () => {
    const value = locker.getSync('a key that not yet created')
    assert.equal(value, undefined)
  })

  it('get invalid secret with default value', () => {
    const value = locker.getSync('a key that not yet created', undefined, 123)
    assert.equal(value, 123)
  })

  it('get 1 environment', () => {
    const env = locker.getEnvironmentSync(testEnv.name)
    assert.equal(env.name, testEnv.name)
    assert.equal(env._raw.id, testEnv._raw.id)
  })

  it('get invalid environment', () => {
    try {
      locker.getEnvironmentSync('an env that not yet created')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })
})
