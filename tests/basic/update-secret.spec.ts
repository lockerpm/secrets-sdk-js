import 'mocha'
import { assert } from 'chai'
import { locker } from '../mocks'

// Create and update secret
describe('Create new and update secret', function () {
  this.timeout(10000)

  it('create secret with env <all>', async () => {
    const payload = {
      key: 'all',
      value: 'a',
    }
    const secret = await locker.create(payload)
    assert.equal(secret.key, payload.key)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, null)
  })

  it('create secret with env <all> again and expect error', async () => {
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

  it('create secret with env test1', async () => {
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

  it('edit secret environment to <all>', async () => {
    const payload = {
      value: '7',
      environmentName: '',
    }
    const secret = await locker.modify('test1', 'init', payload)
    assert.equal(secret.value, payload.value)
    assert.equal(secret.environmentName, null)
  })
})
