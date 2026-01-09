/**
 * Anthropic Provider
 *
 * Implements the Provider interface for Anthropic Claude API
 */

import type { FormatId } from '../../formats/base'
import { getFormat } from '../../formats/registry'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types'
import type { ProviderConfig, ProviderName } from '../base'
import { BaseProvider } from '../base'
import type { AnthropicRequest, AnthropicResponse } from './types'

/**
 * Anthropic Provider implementation
 */
export class AnthropicProvider extends BaseProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  constructor(name: ProviderName = 'anthropic') {
    super()
    this.name = name
    this.config = {
      name,
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      authType: 'apiKey',
    }
  }

  isSupportedRequest(request: unknown): boolean {
    return getFormat('anthropic-messages').isSupportedWireRequest(request)
  }

  /**
   * Parse Anthropic request format into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest {
    return getFormat('anthropic-messages').parseRequest(request)
  }

  /**
   * Transform UnifiedRequest into Anthropic request format
   */
  transform(request: UnifiedRequest, model: string): AnthropicRequest {
    return getFormat('anthropic-messages').buildWireRequest(request, {
      provider: this.name,
      model,
    }) as AnthropicRequest
  }

  /**
   * Parse Anthropic response format into UnifiedResponse
   */
  parseResponse(response: unknown): UnifiedResponse {
    return getFormat('anthropic-messages').parseResponse(response)
  }

  /**
   * Transform UnifiedResponse into Anthropic response format
   */
  transformResponse(response: UnifiedResponse): AnthropicResponse {
    return getFormat('anthropic-messages').buildWireResponse(response, {
      provider: this.name,
      model: response.model || 'unknown',
    }) as AnthropicResponse
  }

  /**
   * Parse an Anthropic SSE stream chunk into unified StreamChunk
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    const parsed = getFormat('anthropic-messages').parseStreamChunk?.(chunk)
    // Handle array or single return, though anthropic format currently returns StreamChunk | null
    if (Array.isArray(parsed)) return parsed[0] || null
    return parsed || null
  }

  /**
   * Transform a unified StreamChunk into Anthropic SSE format
   */
  transformStreamChunk(chunk: StreamChunk): string | string[] {
    const transformed = getFormat('anthropic-messages').buildStreamChunk?.(chunk, {
      provider: this.name,
      model: 'unknown', // Model not always available in stream chunk context
    })
    return transformed || []
  }

  /**
   * Get the schema format ID for this provider's models.
   * Anthropic provider always uses anthropic-messages format.
   */
  getFormatForModel(_model: string): FormatId {
    return 'anthropic-messages'
  }

  /**
   * Detect the format from an incoming wire request.
   * Anthropic Messages format detection.
   */
  getFormatForWireRequest(request: unknown): FormatId {
    if (this.isSupportedRequest(request)) {
      return 'anthropic-messages'
    }
    throw new Error('Unsupported request format for Anthropic provider')
  }

  /**
   * Parse an Anthropic error into UnifiedError
   */
  parseError(error: unknown): import('../../types/error').UnifiedError {
    const unifiedError: import('../../types/error').UnifiedError = {
      provider: this.name,
      code: 'unknown_error',
      message: 'Unknown error',
      retryable: false,
      originalError: error,
    }

    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>
      // Handle Anthropic error format: { type: 'error', error: { type, message } }
      const errorObj = (err.error || err) as Record<string, unknown>

      unifiedError.message = String(errorObj.message || error)

      if (typeof err.status === 'number') {
        unifiedError.statusCode = err.status
      }

      // Map Anthropic error types
      const errorType = errorObj.type

      if (errorType === 'invalid_request_error') {
        unifiedError.code = 'invalid_request_error'
      } else if (errorType === 'authentication_error') {
        unifiedError.code = 'authentication_error'
      } else if (errorType === 'permission_error') {
        unifiedError.code = 'permission_error'
      } else if (errorType === 'rate_limit_error') {
        unifiedError.code = 'rate_limit_error'
        unifiedError.retryable = true
      } else if (errorType === 'api_error' || errorType === 'overloaded_error') {
        unifiedError.code = 'server_error'
        unifiedError.retryable = true
      }

      if (unifiedError.statusCode === 429) {
        unifiedError.code = 'rate_limit_error'
        unifiedError.retryable = true
      } else if (unifiedError.statusCode && unifiedError.statusCode >= 500) {
        unifiedError.code = 'server_error'
        unifiedError.retryable = true
      }
    } else {
      unifiedError.message = String(error)
    }

    return unifiedError
  }
}

export * from './types'
