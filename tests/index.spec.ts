import 'mocha'
import { assert } from 'chai'
import { locker } from '../index'
import { Secret, Environment } from '../src/resources'

require('dotenv').config()

describe('List existing secrets and environments', () => {
  let testSecret: Secret
  let testEnv: Environment

  before(() => {
    locker.accessKey = process.env.ACCESS_KEY || ''
  })

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
    const value = await locker.get('a key that not yet created', undefined, 123)
    assert.equal(value, 123)
  })

  it('get 1 environment', async () => {
    const env = await locker.getEnvironment(testEnv.name)
    assert.equal(env.name, testEnv.name)
    assert.equal(env._raw.id, testEnv._raw.id)
  })

  it('get invalid environment', async () => {
    try {
      await locker.getEnvironment('an env that not yet created')
    } catch (e) {
      assert.instanceOf(e, Error)
    }
  })
})

describe('Create new and update env', () => {
  before(() => {
    locker.accessKey = process.env.ACCESS_KEY || ''
  })

  it('create environment', async () => {
    const payload = {
      name: 'test1',
      externalUrl: 'abc',
    }
    const env = await locker.createEnvironment(payload)
    assert.equal(env.name, payload.name)
    assert.equal(env.externalUrl, payload.externalUrl)
  })

  it('edit environment', async () => {
    const payload = {
      externalUrl: '123123123',
    }
    const env = await locker.modifyEnvironment('test1', payload)
    assert.equal(env.externalUrl, payload.externalUrl)
  })
})
