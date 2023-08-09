import { EmptyOutputError } from '../abstraction/errors'
import { Environment, Secret } from '../resources'

export class Converter {
  public static toSecrets(output: string) {
    const objs = extractDataFromOutput(output)
    if (!Array.isArray(objs)) {
      throw Error('Invalid secrets')
    }
    return objs.map((obj) => new Secret(obj))
  }

  public static toSecret(output: string) {
    const obj = extractDataFromOutput(output)
    if (typeof obj !== 'object') {
      throw Error('Invalid secret')
    }
    return new Secret(obj)
  }

  public static toEnvironments(output: string) {
    const objs = extractDataFromOutput(output)
    if (!Array.isArray(objs)) {
      throw Error('Invalid environments')
    }
    return objs.map((obj) => new Environment(obj))
  }

  public static toEnvironment(output: string) {
    const obj = extractDataFromOutput(output)
    if (typeof obj !== 'object') {
      throw Error('Invalid environment')
    }
    return new Environment(obj)
  }
}

const extractDataFromOutput = (output: string) => {
  try {
    const dataString = output.split('----------- LOG BREAK -----------')[1]
    if (dataString.trim()) {
      return JSON.parse(dataString)
    }
  } catch (error) {
    throw Error('Invalid output')
  }
  throw new EmptyOutputError()
}
