import 'mocha'
import { assert } from 'chai'
import { Secret, Environment } from '../src/resources'
import { locker } from './mocks'

require('dotenv').config()

/**
 * Test synchronized functions
 */

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
    const value = locker.getSync('a key that not yet created', undefined, '123')
    assert.equal(value, '123')
  })

  it('get 1 environment', () => {
    const env = locker.getEnvironmentSync(testEnv.name)
    assert.equal(env.name, testEnv.name)
    assert.equal(env._raw.id, testEnv._raw.id)
  })

  it('get invalid environment and expect error', () => {
    try {
      locker.getEnvironmentSync('an env that not yet created')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })
})
