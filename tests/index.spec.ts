import 'mocha'
import { assert } from 'chai'
import { Secret, Environment } from '../src/resources'
import { locker } from './mocks'

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

// Listing
describe('List existing secrets and environments', function () {
  this.timeout(10000)

  let testSecret: Secret
  let testEnv: Environment

  it('list secrets', async () => {
    const secrets = await locker.list()
    assert.isArray(secrets)
    assert.isNotEmpty(secrets)
    assert.instanceOf(secrets[0], Secret)
    testSecret = secrets[0]
  })

  it('list environments', async () => {
    const environments = await locker.listEnvironments()
    assert.isArray(environments)
    assert.isNotEmpty(environments)
    assert.instanceOf(environments[0], Environment)
    testEnv = environments[0]
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
    const value = await locker.get(
      'a key that not yet created',
      undefined,
      '123'
    )
    assert.equal(value, '123')
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

// Create and update env
describe('Create new and update env', function () {
  this.timeout(10000)

  it('create environment', async () => {
    const payload = {
      name: 'test1',
      externalUrl: 'abc',
    }
    const env = await locker.createEnvironment(payload)
    assert.equal(env.name, payload.name)
    assert.equal(env.externalUrl, payload.externalUrl)
  })

  it('create environment with the exact name and expect error', async () => {
    const payload = {
      name: 'test1',
      externalUrl: '123123',
    }
    let res: any
    try {
      res = await locker.createEnvironment(payload)
    } catch (error) {
      res = error
    }
    assert.instanceOf(res, Error)
  })

  it('edit environment', async () => {
    const payload = {
      externalUrl: '123123123',
    }
    const env = await locker.modifyEnvironment('test1', payload)
    assert.equal(env.externalUrl, payload.externalUrl)
  })
})

// Creata and update secret
describe('Create new and update secret', function () {
  this.timeout(10000)

  it('create secret with env All', async () => {
    const payload = {
      key: 'all',
      value: 'a',
    }
    const secret = await locker.create(payload)
    assert.equal(secret.key, payload.key)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, '')
  })

  it('create secret with env All again and expect error', async () => {
    const payload = {
      key: 'all',
      value: 'a',
    }
    let res: any
    try {
      res = await locker.create(payload)
    } catch (error) {
      res = error
    }
    assert.instanceOf(res, Error)
  })

  it('create secret with env', async () => {
    const payload = {
      key: 'test1',
      value: '1',
      environmentName: 'test1',
    }
    const secret = await locker.create(payload)
    assert.equal(secret.key, payload.key)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, payload.environmentName)
  })

  it('create secret with duplicated key in the same env and expect error', async () => {
    const payload = {
      key: 'test1',
      value: '2',
      environmentName: 'test1',
    }
    let res: any
    try {
      res = await locker.create(payload)
    } catch (e) {
      res = e
    }
    assert.instanceOf(res, Error)
  })

  it('create secret with invalid env and expect error', async () => {
    const payload = {
      key: 'test2',
      value: '3',
      environmentName: 'not existed',
    }
    let res: any
    try {
      res = await locker.create(payload)
    } catch (e) {
      res = e
    }
    assert.instanceOf(res, Error)
  })

  it('create secret with duplicated key but different env', async () => {
    const payload = {
      key: 'test1',
      value: '4',
      environmentName: 'init',
    }
    const secret = await locker.create(payload)
    assert.equal(secret.key, payload.key)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, payload.environmentName)
  })

  it('edit secret value', async () => {
    const payload = {
      value: '5',
      environmentName: 'test1',
    }
    const secret = await locker.modify('test1', 'test1', payload)
    assert.equal(secret.value, payload.value)
  })

  it('edit secret environment but there is another secret with the same name in that environment and expect error', async () => {
    const payload = {
      value: '6',
      environmentName: 'init',
    }
    let res: any
    try {
      res = await locker.modify('test1', 'test1', payload)
    } catch (e) {
      res = e
    }
    assert.instanceOf(res, Error)
  })

  it('edit secret environment', async () => {
    const payload = {
      value: '7',
    }
    const secret = await locker.modify('test1', 'init', payload)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, '')
  })
})
