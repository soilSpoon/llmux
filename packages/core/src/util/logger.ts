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
const pinoLogger: Logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
})

export interface LogContext {
  service?: string
  module?: string
  requestId?: string
  [key: string]: unknown
}

/**
 * Create a scoped logger with context tags
 */
export function createLogger(context: LogContext): ReturnType<typeof pinoLogger.child> {
  return pinoLogger.child(context)
}

/**
 * Default logger instance
 */
export const logger: typeof pinoLogger = pinoLogger

export type { pino }
