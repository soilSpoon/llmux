/**
 * Anthropic Provider
 *
 * Implements the Provider interface for Anthropic Claude API
 */

import type { FormatId } from '../../formats/base'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import type { ProviderConfig, ProviderName } from '../base'
import { BaseProvider } from '../base'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import {
  parseStreamChunk as parseStream,
  transformStreamChunk as transformStream,
} from './streaming'
import {
  type AnthropicRequest,
  type AnthropicResponse,
  isAnthropicRequest,
  isAnthropicResponse,
} from './types'

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
      defaultMaxTokens: 4096,
    }
  }

  isSupportedRequest(request: unknown): boolean {
    if (!isAnthropicRequest(request)) return false
    // Anthropic requests usually have top-level system property
    return typeof request === 'object' && request !== null && 'system' in request
  }

  isSupportedModel(model: string): boolean {
    return model.includes('claude')
  }

  /**
   * Parse Anthropic request format into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest {
    // Validation is handled inside parse() to allow for normalization first
    return parse(request)
  }

  /**
   * Transform UnifiedRequest into Anthropic request format
   */
  transform(request: UnifiedRequest): AnthropicRequest {
    return transform(request)
  }

  /**
   * Parse Anthropic response format into UnifiedResponse
   */
  parseResponse(response: unknown): UnifiedResponse {
    if (!isAnthropicResponse(response)) {
      throw new Error('Invalid Anthropic response: missing required fields')
    }
    return parseResponse(response)
  }

  /**
   * Transform UnifiedResponse into Anthropic response format
   */
  transformResponse(response: UnifiedResponse): AnthropicResponse {
    return transformResponse(response)
  }

  /**
   * Parse an Anthropic SSE stream chunk into unified StreamChunk
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    return parseStream(chunk)
  }

  /**
   * Transform a unified StreamChunk into Anthropic SSE format
   */
  transformStreamChunk(chunk: StreamChunk): string | string[] {
    return transformStream(chunk)
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

export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
// Re-export types and functions for convenience
export * from './types'
