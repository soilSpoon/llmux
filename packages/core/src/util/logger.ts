/**
 * Logger utility using Pino for structured logging
 *
 * Usage:
 *   import { logger } from './logger'
 *   logger.info('Message', { key: 'value' })
 *   logger.debug('Debug message')
 *   logger.error('Error occurred', error)
 *   logger.warn('Warning message')
 */

import pino, { type Logger } from 'pino'

// Determine log level from environment variable (default: INFO)
const logLevel: string = process.env.DEBUG ? 'debug' : (process.env.LOG_LEVEL ?? 'info')

// Create base logger with pino
const baseLogger: Logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,service,module,requestId',
      singleLine: true,
    },
  },
})

export interface AppLogger extends Logger {
  debugTemp(obj: unknown, msg?: string): void
  debugTemp(msg: string): void
}

const pinoLogger = baseLogger as AppLogger

// Temporary debug method for easier cleanup later (same level as debug, but searchable as debugTemp)
pinoLogger.debugTemp = (objOrMsg: unknown, msg?: string) => {
  if (typeof objOrMsg === 'string') {
    pinoLogger.debug(objOrMsg)
  } else {
    pinoLogger.debug(objOrMsg as object, msg)
  }
}

export interface LogContext {
  service?: string
  module?: string
  requestId?: string
  [key: string]: unknown
}

/**
 * Create a scoped logger with context tags
 */
export function createLogger(context: LogContext): AppLogger {
  return pinoLogger.child(context) as AppLogger
}

/**
 * Default logger instance
 */
export const logger: AppLogger = pinoLogger

export type { pino }
