import 'mocha'
import { locker } from '../mocks'
import * as path from 'path'
import * as fs from 'fs'

const rootDir = path.resolve(__dirname, '../../')
const outputDir = path.join(rootDir, 'output-test')

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir)
}

describe('Export secrets', function () {
  this.timeout(10000)

  it('export to txt', async () => {
    await locker.export({
      outputFile: path.join(outputDir, 'test.txt'),
      env: 'init',
    })
  })

  it('export to json', async () => {
    await locker.export({
      outputFile: path.join(outputDir, 'test.json'),
      format: 'json',
    })
  })

  it('export to env', async () => {
    await locker.export({
      outputFile: path.join(outputDir, 'env.test'),
      format: 'env',
    })
  })
})
