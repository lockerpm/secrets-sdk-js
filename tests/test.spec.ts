import 'mocha'

require('dotenv').config()

/**
 * Random tests
 */

const delay = (timeout: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, timeout)
  })

describe('Testing mocha', function () {
  // Default timeout is 2000ms
  this.timeout(4000)

  it('Extend timeout globally', async () => {
    await delay(3000)
  })

  it('Extend timeout manually', async () => {
    await delay(5000)
  }).timeout(6000)
})
