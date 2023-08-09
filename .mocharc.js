'use strict';

module.exports = {
  extension: ['ts'],
  spec: './**/*.spec.ts',
  require: 'ts-node/register',
  ignore: [
    // './tests/index.spec.ts',
    './tests/revoked.spec.ts',
    './tests/invalid.spec.ts',
    './tests/readonly.spec.ts'
  ]
}