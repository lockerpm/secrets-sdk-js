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

- Node 16+

## Installation

Install from npm:

```
npm install -S locker-secrets
```

Install from yarn:

```
yarn add locker-secrets
```

## Usages

### Set up access key

The SDK needs to be configured with your access key which is available in your Locker Secret Dashboard. 
Initialize the `accessKey` to its value. 
You also need to set `apiBase` value (default is `https://secrets-core.locker.io`).

If you need to set your custom headers, you can set the `headers` value in the params:

```
import { Locker } from 'locker-secrets'

const locker = new Locker({
  accessKey: '<your access key>',
  apiBase: '<your api base>',
  // optional
  headers: {
    '<header name>': '<value>'
  }
})
```

Now, you can use SDK to get or set values:

```
// Get list secrets quickly
const secrets = await locker.list()
// or
const secrets = locker.listSync()

// Get a secret value by secret key. 
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

// Update new secret
const secret = await locker.modify('SECRET', {
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
```
const locker = new Locker({
  ...
  logLevel: 1  // default is ERROR
})
```

## Development

Install required packages.
```
npm install
```

### Run tests

Create a .env file with required access keys (refer to `.env.example`)

To run all tests, use:
```
npm test
```

Run some tests only, please update `mocharc.js`:
```
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
