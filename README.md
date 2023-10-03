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
npm install -S lockerpm
```

Install from yarn:

```bash
yarn add lockerpm
```

## Usages

### Set up access key

The SDK needs to be configured with your access key which is available in your Locker Secret Dashboard. 
Initialize the `accessKeyId` and `accessKeySecret` to their value. 
You also need to set `apiBase` value (default value is `https://secrets-core.locker.io`).

```js
import { Locker } from 'lockerpm'

const locker = new Locker({
  accessKeyId: '<your access key id>',
  accessKeySecret: '<your access key secret>',
  apiBase: '<your api base>'
})
```

All initialization options are listed below:

| Key                   | Description                              | Type                                  | Required |
| --------------------- | ---------------------------------------- | ------------------------------------- | :--:     |
| accessKeyId           | Your access key id                       | `string`                              | ✅       | 
| accessKeySecret       | Your access key secret                   | `string`                              | ✅       | 
| apiBase               | Your server base API URL, default value is `https://secrets-core.locker.io` | `string` | ❌       | 
| headers               | Custom headers for API calls             | `{[header: string]: string}`          | ❌       | 
| unsafe                | Set TLS to unsafe if you use a server with self-signed certificate, default value is `false`   | `boolean` | ❌       | 
| logLevel              | Refer to [Logging](#logging), default value is `1`  | `number`                         | ❌       | 


Now, you can use SDK to get or set values:

```js
// Get list secrets quickly
const secrets = await locker.list()
// or
const secrets = locker.listSync()

// Get a secret value by secret key
// Replace 'ENVIRONMENT' with null or undefined for the enviroment ALL 
const secretValue1 = await locker.get('SECRET_NAME_1')
const secretValue2 = await locker.get('SECRET_NAME_2', 'ENVIRONMENT')
const secretValue3 = await locker.get('SECRET_NAME_3', 'ENVIRONMENT', 'default value')
// or
const secretValue3 = locker.getSync('SECRET_NAME_3', 'ENVIRONMENT', 'default value')

// Create new secret
const secret = await locker.create({
  key: 'key',
  value: 'value',
  environmentName: 'environmentName'
})

// Update secret
const secret = await locker.modify('SECRET', 'ENVIRONMENT', {
  value: 'value',
  environmentName: 'environmentName'
})

// List environments
const environments = await locker.listEnvironments()
// or
const environments = locker.listEnvironmentsSync()

// Get an environment object by name
const environment = await locker.getEnvironment('prod')
// or
const environment = locker.getEnvironmentSync('prod')

# Create new environment
const newEnvironment = await locker.createEnvironment({
  name: 'name',
  externalUrl: 'externalUrl'
})

# Update an environment by name
const environment = await locker.modifyEnvironment("name", {
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

## Development

Install required packages.
```bash
npm install
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
  './tests/revoked.spec.ts',
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
