import 'mocha'
import { assert } from 'chai'
import { locker } from '../mocks'

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

  it('create environment with duplicated name and expect error', async () => {
    const payload = {
      name: 'test1',
      externalUrl: '123123',
    }
    let res: any
    try {
      res = await locker.createEnvironment(payload, {
        fetch: true,
      })
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
