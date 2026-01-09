import {
  createLogger,
  type FormatId,
  formatIdToProviderName,
  getProvider,
  type ProviderName,
  transformResponse,
} from '@llmux/core'
import { accumulateGeminiResponse } from './gemini-response'
import { accumulateOpenAIResponse } from './openai-response'

const logger = createLogger({ service: 'response-factory' })

function isGeminiSseProvider(provider: string, model: string): boolean {
  if (provider === 'antigravity' || provider === 'gemini-cli') return true
  if (provider === 'opencode-zen' && model.startsWith('gemini-')) return true
  return false
}

function isOpenAISseProvider(provider: string, model: string): boolean {
  if (provider === 'openai' || provider === 'openai-web') return true
  if (provider === 'opencode-zen') {
    if (model.includes('claude')) return false
    if (model.startsWith('gemini-')) return false
    return true
  }
  return false
}

/**
 * Context for response transformation
 */
export interface TransformContext {
  sourceFormat: FormatId
  targetProvider: ProviderName
  model: string
  reqId: string
}

/**
 * JSON response handler
 */
export type JsonResponseHandler = (response: Response) => Promise<Response>

/**
 * Create a JSON response transformer based on format
 */
export function createJsonResponseTransformer(ctx: TransformContext): JsonResponseHandler {
  const { sourceFormat, targetProvider, model, reqId } = ctx

  return async (upstreamResponse: Response): Promise<Response> => {
    const contentType = upstreamResponse.headers.get('content-type') || ''

    if (!upstreamResponse.ok) {
      // Pass through error responses
      return upstreamResponse
    }

    try {
      let responseBody: unknown

      if (contentType.includes('text/event-stream')) {
        logger.debug(
          { reqId, provider: targetProvider },
          '[response-factory] Converting SSE to JSON'
        )
        const reader = upstreamResponse.body?.getReader() as
          | ReadableStreamDefaultReader<Uint8Array>
          | undefined
        if (!reader) throw new Error('No body available for SSE accumulation')

        let rawAggregated: unknown | null = null
        if (isGeminiSseProvider(targetProvider, model)) {
          rawAggregated = await accumulateGeminiResponse(reader)
        } else if (isOpenAISseProvider(targetProvider, model)) {
          rawAggregated = await accumulateOpenAIResponse(reader)
        } else {
          logger.warn(
            { reqId, provider: targetProvider },
            'Unknown SSE provider, attempting Gemini accumulation'
          )
          rawAggregated = await accumulateGeminiResponse(reader)
        }

        if (!rawAggregated) {
          throw new Error('Failed to accumulate SSE response')
        }

        // Special handling for Gemini accumulation if it's already wrapped in { response: ... }
        // or needs to be. (Based on proxy.ts current logic)
        if (isGeminiSseProvider(targetProvider, model)) {
          responseBody = { response: rawAggregated }
        } else {
          responseBody = rawAggregated
        }
      } else if (contentType.includes('application/json')) {
        responseBody = await upstreamResponse.json()
      } else {
        logger.warn(
          { reqId, contentType },
          '[response-factory] Unexpected content type, passing through'
        )
        return upstreamResponse
      }

      const transformed = transformResponse(responseBody, {
        from: targetProvider,
        to: formatIdToProviderName(sourceFormat),
        model,
      })

      return new Response(JSON.stringify(transformed), {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...Object.fromEntries(
            Array.from(upstreamResponse.headers.entries()).filter(
              ([key]) => key.toLowerCase() !== 'content-type'
            )
          ),
        },
      })
    } catch (error) {
      logger.error(
        { reqId, error: error instanceof Error ? error.message : String(error) },
        '[response-factory] JSON transformation failed'
      )
      throw error
    }
  }
}

/**
 * Get the appropriate schema format handler for request parsing
 * Returns only stream-related handlers that are directly available on Provider
 */
export function getFormatSchema(formatId: FormatId) {
  const providerName = formatIdToProviderName(formatId)
  const provider = getProvider(providerName)

  return {
    parseStreamChunk: provider.parseStreamChunk?.bind(provider),
    transformStreamChunk: provider.transformStreamChunk?.bind(provider),
    parseRequest: provider.parse.bind(provider),
    transformResponse: provider.transformResponse.bind(provider),
  }
}

/**
 * Check if format transformation is needed
 * (i.e., source and target formats are different)
 */
export function needsTransformation(sourceFormat: FormatId, targetProvider: ProviderName): boolean {
  const sourceProvider = formatIdToProviderName(sourceFormat)
  return sourceProvider !== targetProvider
}
