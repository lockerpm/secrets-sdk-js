import { Locker } from '../../src'
import { LogLevel } from '../../src/abstraction'

require('dotenv').config()

const accessKey = process.env.ACCESS_KEY || ''
const [accessKeyId, accessKeySecret] = accessKey.split(':')

export const locker = new Locker({
  accessKeyId,
  accessKeySecret,
  headers: {
    'cf-access-client-id': process.env.CF_ACCESS_CLIENT_ID || '',
    'cf-access-client-secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
  },
  apiBase: process.env.BASE_API,
  logLevel: LogLevel.DEBUG,
})
