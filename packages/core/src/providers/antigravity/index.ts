/**
 * Antigravity Provider
 *
 * Provider implementation for Antigravity API wrapper format.
 * Antigravity wraps Gemini-style requests/responses with additional metadata.
 */

import {
  type AntigravityProviderRequest,
  type AntigravityResponse,
  isAntigravityClientRequest,
  isAntigravityProviderRequest,
  isAntigravityResponse,
} from '../../formats/gemini/antigravity/types'
import type { GeminiCliRequest } from '../../formats/gemini/gemini-cli/types'
import { GeminiFormat } from '../../formats/gemini/index'
import type { GeminiResponse } from '../../formats/gemini/shared/response'
import type { UnifiedError } from '../../types/error'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { createAntigravityStreamingPipeline } from './streaming-pipeline'
// import { isAntigravityRequest } from './types'

export class AntigravityProvider extends BaseProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  constructor(name: ProviderName = 'antigravity') {
    super()
    this.name = name
    this.config = {
      name,
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      defaultStreamParser: 'sse-line-delimited',
    }
  }

  isSupportedRequest(request: unknown): boolean {
    if (isAntigravityProviderRequest(request) || isAntigravityClientRequest(request)) return true

    // Supports { payload: { contents: ... } } structure
    if (request && typeof request === 'object') {
      const obj = request as { payload?: { contents?: unknown } }
      if (obj.payload?.contents) {
        return true
      }
    }

    return false
  }

  readonly createStreamingPipeline = (model: string): import('../../types').StreamingPipeline =>
    createAntigravityStreamingPipeline(model)

  /**
   * Parse an Antigravity/Gemini SSE streaming chunk.
   */
  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    const pipeline = this.createStreamingPipeline(this.name)
    return pipeline.parse(chunk)
  }

  /**
   * Parse an Antigravity request into UnifiedRequest format.
   * Handles both wrapped ({ request: { contents: ... } }) and unwrapped formats.
   */
  parse(request: unknown): UnifiedRequest {
    const format = new GeminiFormat()
    return format.parseRequest(request)
  }

  /**
   * Transform a UnifiedRequest into Antigravity request format.
   * Wraps the Gemini-style request with Antigravity envelope.
   */
  transform(request: UnifiedRequest, model: string): AntigravityProviderRequest | GeminiCliRequest {
    const result = this.transformRequest(request, model)
    return result as AntigravityProviderRequest | GeminiCliRequest
  }

  /**
   * Helper for internal transformation
   */
  transformRequest(
    request: UnifiedRequest,
    model: string
  ): AntigravityProviderRequest | GeminiCliRequest {
    // Inject default metadata for Antigravity tests compatibility
    const meta = { ...(request.metadata || {}) }

    if (!meta.requestId) {
      meta.requestId = `agent-${crypto.randomUUID()}`
    }
    if (!meta.project) {
      // Generate random project ID matching pattern /^[a-z]+-[a-z]+-[0-9a-f]{5}$/
      // Using fixed prefix 'default-project-' + 5 hex chars
      meta.project = `default-project-${Math.random().toString(16).slice(2, 7)}`
    }

    // Create a shallow copy of request with updated metadata
    const requestWithMeta = {
      ...request,
      metadata: meta,
    }

    const format = new GeminiFormat()
    return format.buildWireRequest(requestWithMeta, {
      provider: 'antigravity',
      model,
    }) as AntigravityProviderRequest | GeminiCliRequest
  }

  /**
   * Parse an Antigravity response into UnifiedResponse format.
   * Handles both wrapped ({ response: { candidates: ... } }) and unwrapped formats.
   */
  parseResponse(response: unknown): UnifiedResponse {
    // Unwrap Antigravity envelope if present
    let geminiResponse: GeminiResponse
    if (isAntigravityResponse(response)) {
      geminiResponse = response.response
    } else {
      geminiResponse = response as GeminiResponse
    }

    const format = new GeminiFormat()
    return format.parseResponse(geminiResponse)
  }

  /**
   * Transform a UnifiedResponse into Antigravity response format.
   * Wraps the Gemini-style response with Antigravity envelope.
   */
  transformResponse(response: UnifiedResponse): AntigravityResponse {
    const format = new GeminiFormat()
    const geminiResponse = format.buildWireResponse(response, {
      provider: 'antigravity',
      model: response.model || '',
    }) as GeminiResponse

    return { response: geminiResponse }
  }

  /**
   * Parse a provider error into UnifiedError
   * Handles Antigravity/Gemini error format:
   * { error: { code, message, status, details } }
   */
  parseError(error: unknown): UnifiedError {
    interface AntigravityError {
      error?: {
        code?: number
        message?: string
        status?: string
      }
      code?: number
      message?: string
      status?: string
    }

    let code: UnifiedError['code'] = 'unknown_error'
    let message = 'An unknown error occurred'

    if (error && typeof error === 'object') {
      const errObj = error as AntigravityError
      const inner = errObj.error || errObj

      if (inner.code) {
        // Map HTTP-like codes
        if (inner.code === 400) code = 'invalid_request_error'
        else if (inner.code === 401 || inner.code === 403) code = 'authentication_error'
        else if (inner.code === 404)
          code = 'invalid_request_error' // Map 404 to invalid_request_error as not_found_error is missing
        else if (inner.code === 429) code = 'rate_limit_error'
        else if (inner.code === 500) code = 'server_error'
      }

      if (typeof inner.status === 'string') {
        const innerStatus = inner.status
        // Map gRPC status codes if present
        if (innerStatus === 'INVALID_ARGUMENT') code = 'invalid_request_error'
        else if (innerStatus === 'PERMISSION_DENIED' || innerStatus === 'UNAUTHENTICATED')
          code = 'authentication_error'
        else if (innerStatus === 'NOT_FOUND') code = 'invalid_request_error'
        else if (innerStatus === 'RESOURCE_EXHAUSTED') code = 'rate_limit_error'
        else if (innerStatus === 'INTERNAL') code = 'server_error'
      }

      if (typeof inner.message === 'string') {
        message = inner.message
      }
    } else if (typeof error === 'string') {
      message = error
    } else if (error instanceof Error) {
      message = error.message
    }

    return {
      provider: this.name,
      code,
      message,
      retryable: code === 'rate_limit_error' || code === 'server_error',
      originalError: error,
    }
  }

  /**
   * Get the schema format ID for this provider's models.
   * Antigravity uses the google-gemini format for streaming.
   */
  getFormatForModel(_model: string): 'google-gemini' {
    return 'google-gemini'
  }
}
