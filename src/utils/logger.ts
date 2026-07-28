import { LogLevel } from '../abstraction/index.js'

export type SafeLogRecord = Readonly<{
  event: string
  method?: string
  requestId?: string | number
  durationMs?: number
  exitCode?: number | null
  signal?: string | null
  errorType?: string
}>

/**
 * Logger accepts only an allow-listed metadata record. Protocol bodies,
 * command output and credentials cannot be passed accidentally.
 */
export class Logger {
  logLevel: LogLevel

  constructor(logLevel?: LogLevel) {
    this.logLevel = LogLevel.ERROR
    this.setLogLevel(logLevel ?? LogLevel.ERROR)
  }

  setLogLevel(level: LogLevel): void {
    if (
      level !== LogLevel.NONE &&
      level !== LogLevel.ERROR &&
      level !== LogLevel.DEBUG
    ) {
      throw new RangeError('log level is invalid')
    }
    this.logLevel = level
  }

  debug(record: SafeLogRecord): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.debug(record)
    }
  }

  error(record: SafeLogRecord): void {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(record)
    }
  }
}
