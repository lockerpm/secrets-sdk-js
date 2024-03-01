'use strict';

module.exports = {
  extension: ['ts'],
  spec: './**/*.spec.ts',
  require: 'ts-node/register',
  ignore: [
    // Basic cases
    './tests/basic/list.spec.ts',
    './tests/basic/update-env.spec.ts',
    './tests/basic/update-secret.spec.ts',

    // Alternative cases
    './tests/others/sync.spec.ts',
    './tests/others/invalid.spec.ts',
    './tests/others/readonly.spec.ts',

    // Example
    './tests/example/example.spec.ts',
    './tests/example/wallet-example.spec.ts',

    // Other tests
    './tests/test.spec.ts',
  ]
}