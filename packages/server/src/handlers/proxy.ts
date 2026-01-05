import {
  createLogger,
  isValidProviderName,
  type ProviderName,
  transformResponse,
} from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { SignatureStore } from '../stores'
import { accumulateGeminiResponse } from './gemini-response'
import { accumulateOpenAIResponse } from './openai-response'
import { handleJsonResponse } from './response-utils'
import type { ProxyOptions } from './types'
import { dispatchWithRetry, NonRetriableError } from './upstream-dispatcher'
import { buildUpstreamRequest } from './upstream-request-builder'

const signatureStore = new SignatureStore()

const logger = createLogger({ service: 'proxy-handler' })

interface ThinkingConfig {
  type?: string
  budget?: number
}

export type { ProxyOptions } from './types'

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

function isGeminiSseProvider(provider: string, model: string): boolean {
  if (provider === 'antigravity' || provider === 'gemini-cli') return true
  if (provider === 'opencode-zen' && model.startsWith('gemini-')) return true
  return false
}

function isOpenAISseProvider(provider: string, model: string): boolean {
  if (provider === 'openai' || provider === 'openai-web') return true
  if (provider === 'opencode-zen') {
    // Claude models use Anthropic format, not OpenAI SSE
    if (model.includes('claude')) return false
    // Gemini models use Gemini format
    if (model.startsWith('gemini-')) return false
    // Default (GLM, GPT, Kimi, etc.) use OpenAI format
    return true
  }
  return false
}

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  const reqId = Math.random().toString(36).slice(2, 8)
  const targetProviderInput = options.targetProvider
  if (targetProviderInput && !isValidProviderName(targetProviderInput)) {
    return new Response(JSON.stringify({ error: `Invalid provider: ${targetProviderInput}` }), {
      status: 400,
    })
  }

  try {
    const body = (await request.json()) as {
      model?: string
      stream?: boolean
      thinking?: ThinkingConfig | boolean
      messages?: Array<{
        role?: string
        content?: Array<{ type?: string; signature?: string }> | string
      }>
      contents?: Array<{
        role?: string
        parts?: Array<{ text?: string; thought?: boolean }>
      }>
    }

    const dispatchResult = await dispatchWithRetry({
      reqId,
      builder: buildUpstreamRequest,
      initialBody: body,
      options,
      mode: 'non-streaming',
      signatureStore,
    })

    const { response: lastResponse, meta } = dispatchResult

    if (!lastResponse) {
      return new Response(JSON.stringify({ error: 'Request failed' }), { status: 500 })
    }

    // Handle Response Transformation
    const contentType = lastResponse.headers.get('content-type') || ''
    const currentProvider = meta?.provider || (options.targetProvider as ProviderName)
    const currentModel = meta?.model || options.targetModel || ''

    // Convert SSE to JSON if needed
    if (contentType.includes('text/event-stream') && !body.stream) {
      logger.debug(
        { reqId, contentType, provider: currentProvider },
        '[non-streaming] Converting SSE to JSON'
      )
      const reader = lastResponse.body?.getReader() as
        | ReadableStreamDefaultReader<Uint8Array>
        | undefined
      if (!reader) throw new Error('No body')

      const startTime = Date.now()
      let isGemini = false
      let aggregated: unknown | null = null

      if (isGeminiSseProvider(currentProvider, currentModel)) {
        isGemini = true
        aggregated = await accumulateGeminiResponse(reader)
      } else if (isOpenAISseProvider(currentProvider, currentModel)) {
        aggregated = await accumulateOpenAIResponse(reader)
      } else {
        // Fallback: try Gemini accumulation as default but warn
        logger.warn(
          { reqId, provider: currentProvider },
          'Unknown SSE provider, attempting Gemini accumulation'
        )
        isGemini = true
        aggregated = await accumulateGeminiResponse(reader)
      }

      const accumulateTime = Date.now() - startTime
      logger.debug(
        { reqId, accumulateTime, hasResponse: !!aggregated },
        '[non-streaming] SSE accumulation complete'
      )

      if (!aggregated) {
        return new Response(JSON.stringify({ error: 'Failed to parse SSE response' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      let transformed: unknown

      if (isGemini) {
        // Gemini provider transformation expects wrapped response
        transformed = transformResponse(
          { response: aggregated },
          {
            from: currentProvider,
            to: formatToProvider(options.sourceFormat),
          }
        )
      } else {
        // OpenAI provider transformation expects direct response object
        transformed = transformResponse(aggregated, {
          from: currentProvider,
          to: formatToProvider(options.sourceFormat),
        })
      }

      const responseBody = JSON.stringify(transformed)
      logger.info(
        { reqId, accumulateTime, responseLength: responseBody.length },
        '[non-streaming] Returning response'
      )
      return new Response(responseBody, {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Standard JSON Response
    if (contentType.includes('application/json')) {
      return handleJsonResponse(lastResponse, {
        currentProvider,
        sourceFormat: options.sourceFormat,
        model: meta?.model || options.targetModel,
      })
    }

    return new Response(lastResponse.body, {
      status: lastResponse.status,
      headers: lastResponse.headers,
    })
  } catch (error) {
    if (error instanceof NonRetriableError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.errorInfo.status || 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(
      { error: message, stack: error instanceof Error ? error.stack : undefined },
      'Handle Proxy Caught Error'
    )
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
