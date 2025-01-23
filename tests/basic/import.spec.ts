import 'mocha'
import { locker } from '../mocks'
import * as path from 'path'

const rootDir = path.resolve(__dirname, '../../')

describe('Import secrets', function () {
  this.timeout(10000)

  it('import from .env', async () => {
    await locker.import(path.join(rootDir, '/tests/mocks/.env.import'))
  })
})
