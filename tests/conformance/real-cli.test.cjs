'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { NodeProcessRunner } = require('../../lib/cjs/src/executors/process.js')

test(
  'real CLI exposes compatible protocol v1 capabilities',
  { skip: !process.env.LOCKER_TEST_CLI_PATH },
  async () => {
    const request = {
      jsonrpc: '2.0',
      id: 'locker-js-real-cli',
      method: 'system.capabilities',
      params: {},
    }
    const result = await new NodeProcessRunner().run(
      process.env.LOCKER_TEST_CLI_PATH,
      ['sdk'],
      Buffer.from(JSON.stringify(request), 'utf8'),
      {
        timeoutMs: 5000,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 64 * 1024,
      },
    )
    const response = JSON.parse(result.stdout)
    assert.equal(response.id, request.id)
    assert.equal(response.result.protocol_version, 1)
    assert.deepEqual(response.result.data.protocol, {
      name: 'locker.sdk',
      min_version: 1,
      max_version: 1,
      transport: 'json-rpc-2.0-stdio',
    })
    assert.deepEqual(
      new Set(response.result.data.methods),
      new Set([
        'environment.create',
        'environment.get',
        'environment.list',
        'environment.list_page',
        'environment.update',
        'secret.create',
        'secret.get',
        'secret.list',
        'secret.list_page',
        'secret.update',
        'system.capabilities',
      ]),
    )
    assert.deepEqual(response.result.data.limits, {
      max_request_bytes: 20 * 1024 * 1024,
      max_response_bytes: 20 * 1024 * 1024,
      max_json_depth: 256,
    })
    assert.equal(
      response.result.data.methods.filter(
        (method) => method === 'system.capabilities',
      ).length,
      1,
    )
    assert.equal(result.exitCode, 0)
  },
)
