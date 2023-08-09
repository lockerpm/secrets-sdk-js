import 'mocha'
import { assert } from 'chai'
import { locker } from '../index'

require('dotenv').config()

// describe('Test Function', () => {
//   it('should be a function', () => {
//     assert.isFunction(getHeight)
//   })

//   it('should run with settings', async () => {
//     const output = await getHeight({
//       settings: {
//         height: 123,
//       },
//     })
//     assert.isNotEmpty(output)
//   })

//   it('should run with file', async () => {
//     const output = await getHeight({
//       settingsFilePath: './tests/settings.example.json',
//     })
//     assert.isNotEmpty(output)
//   })

//   it('should error if empty', () => {
//     assert.throw(() => getHeight({}), Error)
//   })

//   it('should error if invalid file', () => {
//     assert.throw(
//       () =>
//         getHeight({
//           settingsFilePath: './not_exists.json',
//         }),
//       Error
//     )
//   })
// })

describe('Test Function', () => {
  it('should be a function', async () => {
    locker.accessKey = process.env.ACCESS_KEY || ''
    await locker.list()
    assert.isFunction(locker.test.coreTest)
  })
})
