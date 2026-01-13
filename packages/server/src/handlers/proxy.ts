import { createLogger, type ProviderName } from '@llmux/core'
import { createJsonResponseTransformer } from './response-factory'
import { buildResponseHeaders, createErrorResponse } from './response-headers'
import type { ProxyOptions } from './types'
import { executeUpstream, NonRetriableError } from './upstream-executor'

const logger = createLogger({ service: 'proxy-handler' })

export type { ProxyOptions } from './types'

export async function handleCountTokens(
  request: Request,
  options: ProxyOptions
): Promise<Response> {
  const reqId =
    request.headers.get('x-llmux-request-id') ||
    request.headers.get('x-request-id') ||
    Math.random().toString(36).slice(2, 8)

  const reqIdHeader = request.headers.get('x-amp-client-request-id') || reqId

  try {
    const body = (await request.json()) as { model?: string }

    const { response: upstreamResponse } = await executeUpstream({
      reqId,
      body,
      options,
      mode: 'count_tokens',
    })

    // Forward upstream response as-is without transformation
    // Just fix headers
    const headers = buildResponseHeaders({
      upstreamHeaders: upstreamResponse.headers,
      requestId: reqIdHeader,
    })

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    })
  } catch (error) {
    if (error instanceof NonRetriableError) {
      return createErrorResponse(error.message, error.errorInfo.status || 500, {
        requestId: reqIdHeader,
        type: 'non_retriable_error',
      })
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(
      { error: message, stack: error instanceof Error ? error.stack : undefined },
      'Handle Count Tokens Caught Error'
    )
    return createErrorResponse(message, 500, {
      requestId: reqIdHeader,
      type: 'internal_server_error',
    })
  }
}

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  const reqId =
    request.headers.get('x-llmux-request-id') ||
    request.headers.get('x-request-id') ||
    Math.random().toString(36).slice(2, 8)

  const targetProviderInput = options.targetProvider
  if (!targetProviderInput) {
    if (options.defaultProvider) {
      options.targetProvider = options.defaultProvider
    }
  }

  const reqIdHeader = request.headers.get('x-amp-client-request-id') || reqId

  try {
    const body = (await request.json()) as {
      model?: string
      stream?: boolean
    }

    const { response: upstreamResponse, meta } = await executeUpstream({
      reqId,
      body,
      options,
      mode: 'non-streaming',
    })

    const transformer = createJsonResponseTransformer({
      sourceFormat: options.sourceFormat,
      targetProvider: meta.provider as ProviderName,
      model: meta.model,
      reqId,
    })

    const response = await transformer(upstreamResponse)

    // Log processed response
    try {
      const responseClone = response.clone()
      const responseText = await responseClone.text()
      let postTransformResponse: unknown
      try {
        postTransformResponse = JSON.parse(responseText)
      } catch {
        postTransformResponse = { _raw: responseText }
      }

      const logStore = require('../stores').getRequestLogStore()
      logStore.updateLog(reqId, {
        postTransformResponse,
        // Update status in case transformer changed it
        statusCode: response.status,
      })
    } catch (logErr) {
      logger.warn({ reqId, error: String(logErr) }, 'Failed to log transformed response')
    }

    // Ensure we have correct headers for the client
    const headers = buildResponseHeaders({
      upstreamHeaders: response.headers,
      requestId: reqIdHeader,
    })

    return new Response(response.body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    if (error instanceof NonRetriableError) {
      return createErrorResponse(error.message, error.errorInfo.status || 500, {
        requestId: reqIdHeader,
        type: 'non_retriable_error',
      })
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(
      { error: message, stack: error instanceof Error ? error.stack : undefined },
      'Handle Proxy Caught Error'
    )
    return createErrorResponse(message, 500, {
      requestId: reqIdHeader,
      type: 'internal_server_error',
    })
  }
}
