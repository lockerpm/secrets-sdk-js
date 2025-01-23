import { Locker, LogLevel } from '../../src'

require('dotenv').config()

const accessKey = process.env.ACCESS_KEY || ''
const [accessKeyId, secretAccessKey] = accessKey.split(':')

export const locker = new Locker({
  accessKeyId,
  secretAccessKey,
  headers: {
    'cf-access-client-id': process.env.CF_ACCESS_CLIENT_ID || '',
    'cf-access-client-secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
  },
  apiBase: process.env.BASE_API,
  logLevel: LogLevel.DEBUG,
  cacheOptions: {
    fetch: false,
    restTime: 120,
  },
})
