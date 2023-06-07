import 'mocha'
import { assert } from 'chai'
import { test } from '../index'

describe('Test Function', () => {
  it('should be a function', () => {
    assert.isFunction(test)
  })

  it('should return the test message', () => {
    const expected = 'test'
    const actual = test()
    assert.equal(actual, expected)
  })
})
