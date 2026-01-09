import { createLogger, type ProviderName } from '@llmux/core'
import { createErrorResponse } from './error-utils'
import { createStreamTransformer, type StreamContext } from './stream-transformer'
import { getSignatureCache } from './thinking/cache-instance'
import type { ProxyOptions } from './types'
import { executeUpstream, getSignatureStore, NonRetriableError } from './upstream-executor'

const logger = createLogger({ service: 'streaming-handler' })

export type { ProxyOptions } from './types'

export { getSignatureStore, NonRetriableError }

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
    accumulatedSignatures: [],
  }

  try {
    const body = (await request.json()) as Record<string, unknown>

    const { response, meta } = await executeUpstream({
      reqId,
      body,
      options,
      mode: 'streaming',
      onBeforeAttempt: (attempt, requestMeta) => {
        if (requestMeta.provider === 'antigravity' && requestMeta.isClaudeFresh) {
          logger.trace(
            {
              reqId,
              attempt,
              model: requestMeta.model,
              provider: requestMeta.provider,
            },
            'DEBUG: Antigravity request for Claude (Fresh)'
          )
        }
      },
    })

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
      endpoint: response.url,
      toolsCount: (body as { tools?: unknown[] }).tools?.length || 0,
      bodyLength: JSON.stringify(body).length,
    }

    if (options.router?.handleSuccess) {
      options.router.handleSuccess(effectiveTargetProvider, currentModel)
    }

    if (!response.body) throw new Error('No response body')

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

    const signatureStore = getSignatureStore()
    const transformStream = createStreamTransformer({
      reqId,
      startTime,
      sourceFormat: options.sourceFormat,
      targetProvider: effectiveTargetProvider as ProviderName,
      streamContext,
      signatureContext: currentProjectId
        ? {
            projectId: currentProjectId,
            provider: effectiveTargetProvider,
            endpoint: response.url,
            account: '',
            signatureStore,
            onSave: (count) => {
              logger.debug(
                { reqId, projectId: currentProjectId, count },
                `Saved ${count} signatures for project: ${currentProjectId}`
              )
            },
            signatureCache: getSignatureCache(),
            sessionId: reqId,
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
