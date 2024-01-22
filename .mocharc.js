'use strict';

module.exports = {
  extension: ['ts'],
  spec: './**/*.spec.ts',
  require: 'ts-node/register',
  ignore: [
    './tests/index.spec.ts',
    './tests/sync.spec.ts',
    './tests/invalid.spec.ts',
    './tests/readonly.spec.ts',
    './tests/test.spec.ts',
    './tests/example.spec.ts',
    './tests/wallet-example.spec.ts'
  ]
}