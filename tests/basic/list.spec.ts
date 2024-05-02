import 'mocha'
import { assert } from 'chai'
import { Secret, Environment } from '../../src/resources'
import { locker } from '../mocks'

/**
 * Functional testing
 * These tests require an existing project with 1 secret named first (All) and 1 env named init
 * Because a SDK doesn't have permission to delete --> no way to clean up
 */

// describe('Setup', function () {
//   this.timeout(10000)

//   it('setup', async () => {
//     await locker.create({ key: 'first', value: '123' })
//     await locker.createEnvironment({ name: 'init', externalUrl: '*' })
//   })
// })

describe('List existing secrets and environments', function () {
  this.timeout(10000)

  let testSecret: Secret // first - 123
  let testEnv: Environment // init

  it('list secrets', async () => {
    const secrets = await locker.list()
    assert.isArray(secrets)
    assert.isNotEmpty(secrets)
    assert.instanceOf(secrets[0], Secret)
    testSecret = secrets.find((s) => s.key === 'first')!
  })

  it('list environments', async () => {
    const environments = await locker.listEnvironments()
    assert.isArray(environments)
    assert.isNotEmpty(environments)
    assert.instanceOf(environments[0], Environment)
    testEnv = environments.find((s) => s.name === 'init')!
  })

  it('get 1 secret (first - 123 - <all>)', async () => {
    const value = await locker.get(testSecret.key)
    assert.equal(value, testSecret.value)
    const value2 = await locker.get(testSecret.key)
    assert.equal(value2, testSecret.value)
  })

  it('get invalid secret and expect undefined', async () => {
    const value = await locker.get('a key that not yet created')
    assert.equal(value, undefined)
  })

  it('get invalid secret and expect default value', async () => {
    const value = await locker.get(
      'a key that not yet created',
      undefined,
      '123'
    )
    assert.equal(value, '123')
  })

  it('retrieve 1 secret (first - 123 - <all>)', async () => {
    const secret = await locker.retrieve(testSecret.key)
    assert.instanceOf(secret, Secret)
    assert.equal(secret.value, testSecret.value)
    const secret2 = await locker.retrieve(testSecret.key)
    assert.instanceOf(secret2, Secret)
    assert.equal(secret2.value, testSecret.value)
  })

  it('retrieve invalid secret and expect error', async () => {
    try {
      await locker.retrieve('a key that not yet created')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })

  it('get 1 environment', async () => {
    const env = await locker.getEnvironment(testEnv.name)
    assert.equal(env.name, testEnv.name)
    assert.equal(env._raw.id, testEnv._raw.id)
  })

  it('get invalid environment and expect error', async () => {
    try {
      await locker.getEnvironment('an env that not yet created')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })
})
