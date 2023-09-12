import { LogLevel } from '../abstraction'

export class Logger {
  logLevel: LogLevel

  constructor(logLevel?: LogLevel) {
    this.logLevel = logLevel || LogLevel.ERROR
  }

  setLogLevel(level: LogLevel) {
    this.logLevel = level
  }

  debug(e: any) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(e)
    }
  }

  error(e: any) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(e)
    }
  }
}
