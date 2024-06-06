import 'mocha'
import { locker } from '../mocks'

describe('Export secrets', function () {
  this.timeout(10000)

  it('export to txt', async () => {
    await locker.export({
      env: 'init',
    })
  })

  it('export to json', async () => {
    await locker.export({
      outputFile: 'test.json',
      format: 'json',
    })
  })

  it('export to env', async () => {
    await locker.export({
      format: 'env',
    })
  })
})
