import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'stream-debug' })

export interface StreamDebugOptions {
  reqId: string
  targetProvider: string
  sourceFormat: string
  enabled: boolean
}

export interface StreamDebugLogger {
  logChunk(text: string): void
  logEvent(event: string): void
  logParseResult(input: string, output: unknown): void
  logFinalResponse(context: Record<string, unknown>): void
}

function createNoopLogger(): StreamDebugLogger {
  return {
    logChunk: () => {},
    logEvent: () => {},
    logParseResult: () => {},
    logFinalResponse: () => {},
  }
}

function createFileLogger(options: StreamDebugOptions): StreamDebugLogger {
  const fs = require('node:fs')
  const debugDir = '/tmp/llmux-debug'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true })
    }
  } catch {
    return createNoopLogger()
  }

  const logPath = `${debugDir}/${timestamp}-${options.reqId}-${options.targetProvider}-stream.log`
  let initialized = false

  const ensureInit = () => {
    if (!initialized) {
      try {
        fs.writeFileSync(
          logPath,
          `=== Stream Debug Log ===\nreqId: ${options.reqId}\ntargetProvider: ${options.targetProvider}\nsourceFormat: ${options.sourceFormat}\nstartTime: ${new Date().toISOString()}\n\n`
        )
        initialized = true
        logger.info({ reqId: options.reqId, path: logPath }, '[DEBUG] Stream logging started')
      } catch {
        // ignore
      }
    }
  }

  return {
    logChunk(text: string) {
      ensureInit()
      try {
        fs.appendFileSync(logPath, `\n--- RAW CHUNK (${text.length} bytes) ---\n${text}\n`)
      } catch {
        // ignore
      }
    },
    logEvent(event: string) {
      ensureInit()
      try {
        fs.appendFileSync(logPath, `\n--- PARSED EVENT ---\n${event}\n`)
      } catch {
        // ignore
      }
    },
    logParseResult(input: string, output: unknown) {
      ensureInit()
      try {
        fs.appendFileSync(
          logPath,
          `\n--- PARSE RESULT ---\nInput: ${input.slice(0, 200)}\nOutput: ${JSON.stringify(output)}\n`
        )
      } catch {
        // ignore
      }
    },
    logFinalResponse(context: Record<string, unknown>) {
      const responsePath = logPath.replace('-stream.log', '-response.json')
      try {
        fs.writeFileSync(responsePath, JSON.stringify(context, null, 2))
        logger.debug(
          { reqId: options.reqId, debugFile: responsePath },
          '[DEBUG] Stream response saved'
        )
      } catch (err) {
        logger.warn(
          { reqId: options.reqId, error: String(err) },
          '[DEBUG] Failed to write response file'
        )
      }
    },
  }
}

export function createStreamDebugLogger(options: StreamDebugOptions): StreamDebugLogger {
  if (!options.enabled) {
    return createNoopLogger()
  }
  return createFileLogger(options)
}

/**
 * Check if debug logging should be enabled for a given provider
 */
export function shouldEnableDebugLogging(targetProvider: string): boolean {
  // Enable debug logging for specific providers that need debugging
  return ['openai-web', 'gemini-cli', 'antigravity'].includes(targetProvider)
}
