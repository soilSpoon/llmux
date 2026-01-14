import {
  createLogger,
  type FormatId,
  formatIdToProviderName,
  getFormat,
  getProvider,
  type ProviderName,
  transformResponse,
} from '@llmux/core'

const logger = createLogger({ service: 'response-factory' })

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
          '[response-factory] Converting SSE to JSON via provider pipeline'
        )
        const reader = upstreamResponse.body?.getReader() as
          | ReadableStreamDefaultReader<Uint8Array>
          | undefined
        if (!reader) throw new Error('No body available for SSE accumulation')

        const provider = getProvider(targetProvider)
        const pipeline = provider.createStreamingPipeline?.(model)

        if (!pipeline || typeof pipeline.accumulateToJson !== 'function') {
          logger.warn(
            { reqId, provider: targetProvider },
            '[response-factory] Provider pipeline missing accumulateToJson, passing through'
          )
          return upstreamResponse
        }

        const rawAggregated = await pipeline.accumulateToJson(reader)
        if (!rawAggregated) {
          throw new Error('Failed to accumulate SSE response')
        }

        // Response body is now provider-specific JSON (handled by pipeline)
        responseBody = rawAggregated
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
 * Uses Format for stream operations and Provider for request/response
 */
export function getFormatSchema(formatId: FormatId) {
  const providerName = formatIdToProviderName(formatId)
  const provider = getProvider(providerName)
  const format = getFormat(formatId)

  return {
    parseStreamChunk: format.parseStreamChunk?.bind(format),
    buildStreamChunk: format.buildStreamChunk?.bind(format),
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
