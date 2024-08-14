# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.1 - 2024-08-14

### Changed

- Update binary version to 1.0.94

## 1.2.0 - 2024-06-06

### Added

- Add `env` parameter to `list` and `listSync` to list secrets by environment
- Add `cacheOptions` to Locker's constructor to config object-level caching strategy
- Add `config` parameter to all methods, allowing method-level caching strategy configuration
- Add an `export` method thats allow exporting secrets into env/json/txt file

### Changed

- Update binary version to 1.0.91
- Update test cases

## 1.1.2 - 2024-05-02

### Fixed

- Cannot replace the binary file during update due to lack of `WRITE` permission

### Changed

- To get or retrieve a secret from `ALL` environment, set the second parameter to `undefined`. Example: `locker.get('key', undefined, 'default-value')`
- Set `environmentName` to `''` when using `modify` to set the secret's env to `ALL`
- Change binary command data and format
- Update binary version to 1.0.88

## 1.1.1 - 2024-03-22

### Changed

- Update binary version to 1.0.82

## 1.1.0 - 2024-03-01

### Added

- Use `retrieve(key, env)` or `retrieveSync(key, env)` to get full Secret object

### Changed

- Separate folder for spec tests
- Update binary version to 1.0.81


## 1.0.2 - 2024-01-30

### Changed

- New project name & home! Now it's `@lockerpm/secrets`
- Update binary version to 1.0.73
