import { EmptyOutputError } from '../abstraction/errors'
import { Environment, Secret } from '../resources'

const SIGNATURE = '----------- LOG BREAK -----------'

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

  public static toError(output: string) {
    if (output.includes(SIGNATURE)) {
      const obj = extractDataFromOutput(output)
      if (obj?.message) {
        return new Error(obj.message)
      }
    }
    return new Error(output)
  }
}

const extractDataFromOutput = (output: string) => {
  try {
    const dataString = output.split(SIGNATURE)[1]
    if (dataString.trim()) {
      return JSON.parse(dataString)
    }
  } catch (error) {
    throw Error('Invalid output')
  }
  throw new EmptyOutputError()
}
