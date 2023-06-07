import 'mocha'
import { assert } from 'chai'
import { heightModule } from '../index'

const { getHeight } = heightModule

describe('Test Function', () => {
  it('should be a function', () => {
    assert.isFunction(getHeight)
  })

  it('should run ok', async () => {
    const output = await getHeight(123)
    assert.isNotEmpty(output)
    const output2 = await getHeight(180)
    assert.isNotEmpty(output2)
  })
})
