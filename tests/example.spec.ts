// Example of how to use Locker to store crypto wallet private keys

import 'mocha'
import { assert } from 'chai'
import { Locker } from '../index'

require('dotenv').config()

const locker = new Locker({
  accessKeyId: process.env.CLOUD_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.CLOUD_ACCESS_KEY_SECRET || '',
})

async function saveWallet(address: string, privateKey: string) {
  await locker.create({
    key: address,
    value: privateKey,
  })
}

async function getWallet(address: string) {
  const secretVal = await locker.get(address)
  return {
    address,
    privateKey: secretVal,
  }
}

async function listWallets() {
  const secrets = await locker.list()
  return secrets.map((secret) => ({
    address: secret.key,
    privateKey: secret.value,
  }))
}

describe('Example for trungnh', function () {
  this.timeout(10000)
  const testAddress = 'abc'
  const testPrivateKey = '123'

  it('set wallet', async () => {
    await saveWallet(testAddress, testPrivateKey)
  })

  it('get wallet', async () => {
    const wallet = await getWallet(testAddress)
    console.log(wallet)
    assert.equal(wallet.privateKey, testPrivateKey)
  })

  it('list wallets', async () => {
    const wallets = await listWallets()
    console.log(wallets)
    assert.isArray(wallets)
  })
})
