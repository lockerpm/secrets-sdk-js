export class EmptyOutputError extends Error {
  constructor() {
    super('Get empty result from binary')
  }
}
