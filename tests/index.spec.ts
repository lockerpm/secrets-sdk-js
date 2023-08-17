import 'mocha'
import { assert } from 'chai'
import { Locker } from '../index'
import { Secret, Environment } from '../src/resources'
import { LogLevel } from '../src/abstraction'

require('dotenv').config()

const locker = new Locker({
  accessKey: process.env.ACCESS_KEY || '',
  headers: {
    'cf-access-client-id': process.env.CF_ACCESS_CLIENT_ID || '',
    'cf-access-client-secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
  },
  logLevel: LogLevel.ERROR,
})

// Listing
describe('List existing secrets and environments', () => {
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

// Create and update env
describe('Create new and update env', () => {
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

// Creata and update secret
describe('Create new and update secret', () => {
  it('create secret', async () => {
    const payload = {
      key: 'test1',
      value: 'abc',
      environmentName: 'test1',
    }
    const secret = await locker.create(payload)
    assert.equal(secret.key, payload.key)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, payload.environmentName)
  })

  // TODO: create/update secret with same name but different env

  it('edit secret', async () => {
    const payload = {
      value: '123123123',
    }
    const secret = await locker.modify('test1', payload)
    assert.equal(secret.value, payload.value)
  })
})
