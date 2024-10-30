# Locker Secret NodeJS SDK

<p align="center">
  <img src="https://cystack.net/images/logo-black.svg" alt="CyStack" width="50%"/>
</p>


---

The Locker Secret NodeJS SDK provides convenient access to the Locker Secret API from applications written in the 
JavaScript language. It includes a pre-defined set of classes for API resources that initialize themselves dynamically 
from API responses which makes it compatible with a wide range of versions of the Locker Secret API.


## The Developer - CyStack

The Locker Secret NodeJS SDK is developed by CyStack, one of the leading cybersecurity companies in Vietnam. 
CyStack is a member of Vietnam Information Security Association (VNISA) and Vietnam Association of CyberSecurity 
Product Development. CyStack is a partner providing security solutions and services for many large domestic and 
international enterprises.

CyStack’s research has been featured at the world’s top security events such as BlackHat USA (USA), 
BlackHat Asia (Singapore), T2Fi (Finland), XCon - XFocus (China)... CyStack experts have been honored by global 
corporations such as Microsoft, Dell, Deloitte, D-link...


## Documentation

The documentation will be updated later.

## Requirements

- Node 12+

## Installation

Install from npm:

```bash
npm install -S lockersm
```

Install from yarn:

```bash
yarn add lockersm
```

## Usages

### Set up access key

The SDK needs to be configured with your access key which is available in your Locker Secret Dashboard. 
Initialize the `accessKeyId` and `secretAccessKey` to their value. 
You also need to set `apiBase` value (default value is `https://api.locker.io/locker_secrets`).

```js
import { Locker } from 'lockersm'

// You should not hardcode access key credentials. Instead, load them from environment variables
const locker = new Locker({
  accessKeyId: process.env.LOCKER_ACCESS_KEY_ID,
  secretAccessKey: process.env.LOCKER_ACCESS_KEY_SECRET,
  apiBase: '<your base api url>'
})
```

All initialization options are listed below:

| Key                   | Description                              | Type                                  | Required |
| --------------------- | ---------------------------------------- | ------------------------------------- | :--:     |
| accessKeyId           | Your access key id                       | `string`                              | ✅       | 
| secretAccessKey       | Your access key secret                   | `string`                              | ✅       | 
| apiBase               | Your server base API URL, default value is `https://api.locker.io/locker_secrets` | `string` | ❌       | 
| headers               | Custom headers for API calls             | `{[header: string]: string}`          | ❌       | 
| unsafe                | Set TLS to unsafe if you use a server with self-signed certificate, default value is `false`   | `boolean` | ❌       | 
| logLevel              | Refer to [Logging](#logging), default value is `1`  | `number`                         | ❌       | 
| cacheOptions          | Default caching strategy, read more in [Caching](#caching) | `CacheOptions` | ❌

Now, you can use SDK to get or set values:

```js
// Get list secrets quickly
const secrets = await locker.list()
// or
const secrets = locker.listSync()

// List secrets by environment
const secretsInProd = await locker.list('production')

// Export secrets to file
await locker.export({
  outputFile: '.env.prod',
  format: 'env',
  env: 'production'
})

// Get a secret value by secret key
// Replace 'ENVIRONMENT' with undefined to get secret from the environment ALL
const secretValue1 = await locker.get('SECRET_NAME_1')
const secretValue2 = await locker.get('SECRET_NAME_2', 'ENVIRONMENT')
const secretValue3 = await locker.get('SECRET_NAME_3', 'ENVIRONMENT', 'default value')
// or
const secretValue3 = locker.getSync('SECRET_NAME_3', 'ENVIRONMENT', 'default value')

// Or get a secret object instead
const secret1 = await locker.retrieve('SECRET_NAME_1')
// or
const secret1 = locker.retrieveSync('SECRET_NAME_1')

// Create new secret
const secret = await locker.create({
  key: 'key',
  value: 'value',
  description: 'description',
  environmentName: 'environmentName'
})

// Update secret
const secret = await locker.modify('SECRET', 'ENVIRONMENT', {
  value: 'new value',
  description: 'new description',
  environmentName: 'environmentName'  // use '' to set environment to ALL
})

// List environments
const environments = await locker.listEnvironments()
// or
const environments = locker.listEnvironmentsSync()

// Get an environment object by name
const environment = await locker.getEnvironment('prod')
// or
const environment = locker.getEnvironmentSync('prod')

// Create new environment
const newEnvironment = await locker.createEnvironment({
  name: 'name',
  description: 'description',
  externalUrl: 'externalUrl'
})

// Update an environment by name
const environment = await locker.modifyEnvironment("name", {
  description: 'new description',
  externalUrl: 'new value',
})
```

### Logging

The library can be configured to emit logging that will give you better insight into what it's doing. 
There are some levels: `NONE (0)`, `ERROR (1)`, `DEBUG (2)`.
Set the logging level when creating a Locker instance to enabling it:
```js
const locker = new Locker({
  // ...
  logLevel: 1  // default is ERROR
})
```

### Caching

By default, Locker fetches data from the cloud server once and stores it in local storage. It only checks for updates every 120 seconds to prevent unnecessary API calls. You can change this behavior at the object level or method level using `fetch` and `restTime`

```js
// Object level, this config will apply to all methods
const locker = new Locker({
  // ...
  cacheOptions: {
    fetch: false // setting it to true will force Locker to fetch from the cloud server instead of local storage
    restTime: 5 // seconds, only accept integer value
  }
})

// Method level, only apply to current method call
const secret = await locker.get('secret', 'env', '', {
  fetch: true
})
```

## Development

Install required packages.
```bash
npm install
```

Download binary into `/bin`
```bash
node setup.js
```

### Run tests

Create a .env file with required access keys (refer to `.env.example`)

To run all tests, use:
```bash
npm test
```

Run some tests only, please update `mocharc.js`:
```js
ignore: [
  // './tests/index.spec.ts', // Comment the file you want to test
  './tests/sync.spec.ts',
  './tests/invalid.spec.ts',
  './tests/readonly.spec.ts'
]
```

## Reporting security issues

We take the security and our users' trust very seriously. If you found a security issue in Locker SDK Python, please 
report the issue by contacting us at <contact@locker.io>. Do not file an issue on the tracker. 


## Contributing

Please check [CONTRIBUTING](CONTRIBUTING.md) before making a contribution.


## Help and media

- FAQ: https://support.locker.io

- Community Q&A: https://forum.locker.io

- News: https://locker.io/blog


## License
