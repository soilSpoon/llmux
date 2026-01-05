import { createLogger } from '@llmux/core'
import { SignatureStore } from '../stores'
import { createErrorResponse } from './error-utils'
import { createStreamTransformer, type StreamContext } from './stream-transformer'
import type { ProxyOptions } from './types'
import { dispatchWithRetry, NonRetriableError } from './upstream-dispatcher'
import { buildUpstreamRequest } from './upstream-request-builder'

const logger = createLogger({ service: 'streaming-handler' })

const signatureStore = new SignatureStore()

export type { ProxyOptions } from './types'

export function getSignatureStore(): SignatureStore {
  return signatureStore
}

// Re-export NonRetriableError for compatibility if needed elsewhere
export { NonRetriableError }

export async function handleStreamingProxy(
  request: Request,
  options: ProxyOptions
): Promise<Response> {
  const startTime = Date.now()
  const reqId = Math.random().toString(36).slice(2, 8)

  const streamContext: StreamContext = {
    reqId,
    fromFormat: options.sourceFormat,
    targetProvider: options.targetProvider || 'unknown',
    targetModel: options.targetModel || 'unknown',
    originalModel: 'unknown',
    finalModel: 'unknown',
    chunkCount: 0,
    totalBytes: 0,
    duration: 0,
    fullResponse: '',
    accumulatedText: '',
    accumulatedThinking: '',
  }

  try {
    const body = (await request.json()) as Record<string, unknown>

    const dispatchResult = await dispatchWithRetry({
      reqId,
      builder: buildUpstreamRequest,
      initialBody: body,
      options,
      mode: 'streaming',
      signatureStore,
      onBeforeAttempt: (attempt, meta) => {
        // [DEBUG] Log attempt info if needed, but dispatcher logs basic info
        if (meta.provider === 'antigravity' && meta.isClaudeFresh) {
          logger.trace(
            {
              reqId,
              attempt,
              model: meta.model,
              provider: meta.provider,
            },
            'DEBUG: Antigravity request for Claude (Fresh)'
          )
        }
      },
    })

    const { response, meta } = dispatchResult
    if (!response || !meta) throw new Error('No response from dispatcher')

    // Extract metadata for stream context
    const currentModel = meta.model
    const effectiveTargetProvider = meta.provider
    const currentProjectId = meta.currentProjectId
    const originalModel = meta.originalModel

    streamContext.originalModel = originalModel
    streamContext.targetProvider = effectiveTargetProvider
    streamContext.finalModel = currentModel
    streamContext.requestInfo = {
      model: currentModel,
      provider: effectiveTargetProvider,
      endpoint: response.url, // Approximate
      toolsCount: (body as { tools?: unknown[] }).tools?.length || 0,
      bodyLength: 0, // Not available without re-serializing
    }

    if (options.router?.handleSuccess) {
      options.router.handleSuccess(effectiveTargetProvider, currentModel)
    }

    if (!response.body) throw new Error('No response body')

    // Handle 500/Non-Retriable passed through as generic response (e.g. all-cooldown)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const errorPayload = { error: { message: text || 'Upstream error', status: response.status } }
      const sseBody = `data: ${JSON.stringify(errorPayload)}\n\n`

      return new Response(sseBody, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    const transformStream = createStreamTransformer({
      reqId,
      startTime,
      sourceFormat: options.sourceFormat,
      targetProvider: effectiveTargetProvider,
      streamContext,
      signatureContext: currentProjectId
        ? {
            projectId: currentProjectId,
            provider: effectiveTargetProvider,
            endpoint: response.url,
            account: '', // Not strictly needed for signature storage logic currently
            signatureStore,
            onSave: (count) => {
              logger.debug(
                { reqId, projectId: currentProjectId, count },
                `Saved ${count} signatures for project: ${currentProjectId}`
              )
            },
          }
        : undefined,
    })

    const bodyStream = response.body
    bodyStream.pipeTo(transformStream.writable).catch((error) => {
      streamContext.error = error instanceof Error ? error.message : String(error)
      logger.error({ reqId, error: streamContext.error }, '[Streaming] Pipe Error')
    })

    return new Response(transformStream.readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime
    const message = error instanceof Error ? error.message : 'Unknown error'
    streamContext.error = message
    const sanitize = (s: string) =>
      s
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const ri = streamContext.requestInfo || {
      model: 'unknown',
      provider: 'unknown',
      endpoint: '',
      toolsCount: 0,
      bodyLength: 0,
    }
    const logMsg = `[Streaming] ${streamContext.reqId} | ${ri.model} (${ri.provider}) | Tools:${ri.toolsCount} | ReqLen:${ri.bodyLength} | ${duration}ms | ERROR: ${sanitize(message)}`
    logger.error(logMsg)

    if (error instanceof NonRetriableError) {
      const payload = createErrorResponse(error.errorInfo)
      return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
        status: error.errorInfo.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    return new Response(`data: ${JSON.stringify({ error: { message, status: 500 } })}\n\n`, {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }
}
