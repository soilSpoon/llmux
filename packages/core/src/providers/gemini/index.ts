/**
 * GeminiProvider - Complete Gemini GenerateContent API provider
 *
 * Handles bidirectional transformation between:
 * - GeminiRequest ↔ UnifiedRequest
 * - GeminiResponse ↔ UnifiedResponse
 * - Gemini SSE stream chunks ↔ UnifiedStreamChunk
 */

import type { FormatId } from '../../formats/base'
import { getFormat } from '../../formats/registry'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig } from '../base'
import type { GeminiRequest, GeminiResponse } from './types'

export class GeminiProvider extends BaseProvider {
  readonly name: 'gemini' | 'gemini-cli'
  readonly config: ProviderConfig

  constructor(name: 'gemini' | 'gemini-cli' = 'gemini') {
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
    return getFormat('google-gemini').isSupportedWireRequest(request)
  }

  /**
   * Parse GeminiRequest into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest {
    return getFormat('google-gemini').parseRequest(request)
  }

  /**
   * Transform UnifiedRequest into GeminiRequest
   */
  transform(request: UnifiedRequest, model: string): GeminiRequest {
    return getFormat('google-gemini').buildWireRequest(request, {
      provider: this.name,
      model,
    }) as GeminiRequest
  }

  /**
   * Parse GeminiResponse into UnifiedResponse
   */
  parseResponse(response: unknown): UnifiedResponse {
    return getFormat('google-gemini').parseResponse(response)
  }

  /**
   * Transform UnifiedResponse into GeminiResponse
   */
  transformResponse(response: UnifiedResponse): GeminiResponse {
    return getFormat('google-gemini').buildWireResponse(response, {
      provider: this.name,
      model: response.model || 'unknown',
    }) as GeminiResponse
  }

  /**
   * Parse SSE stream chunk from Gemini format
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    const parsed = getFormat('google-gemini').parseStreamChunk?.(chunk)
    // Handle array or single return
    if (Array.isArray(parsed)) return parsed[0] || null
    return parsed || null
  }

  /**
   * Transform unified stream chunk to Gemini SSE format
   */
  transformStreamChunk(chunk: StreamChunk): string {
    const result = getFormat('google-gemini').buildStreamChunk?.(chunk, {
      provider: this.name,
      model: 'unknown',
    })
    return Array.isArray(result) ? result.join('\n') : result || ''
  }

  /**
   * Parse a Gemini error into UnifiedError
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
      // Gemini/Google error format: { error: { code, message, status, details } }
      const errorObj = (err.error || err) as Record<string, unknown>

      unifiedError.message = String(errorObj.message || error)
      unifiedError.providerCode = String(errorObj.code || '')

      if (errorObj.status) {
        // Map string status to code if possible, or numeric code
        // Gemini often uses string status like 'INVALID_ARGUMENT'
      }

      // Map Gemini error codes/statuses
      const status = errorObj.status || errorObj.code

      if (status === 400 || status === 'INVALID_ARGUMENT') {
        unifiedError.code = 'invalid_request_error'
        unifiedError.statusCode = 400
      } else if (status === 401 || status === 'UNAUTHENTICATED') {
        unifiedError.code = 'authentication_error'
        unifiedError.statusCode = 401
      } else if (status === 403 || status === 'PERMISSION_DENIED') {
        unifiedError.code = 'permission_error'
        unifiedError.statusCode = 403
      } else if (status === 429 || status === 'RESOURCE_EXHAUSTED') {
        unifiedError.code = 'rate_limit_error'
        unifiedError.statusCode = 429
        unifiedError.retryable = true
      } else if (status === 500 || status === 'INTERNAL') {
        unifiedError.code = 'server_error'
        unifiedError.statusCode = 500
        unifiedError.retryable = true
      } else if (status === 503 || status === 'UNAVAILABLE') {
        unifiedError.code = 'server_error'
        unifiedError.statusCode = 503
        unifiedError.retryable = true
      }
    } else {
      unifiedError.message = String(error)
    }

    return unifiedError
  }

  /**
   * Get the schema format ID for this provider's models.
   * Gemini uses the google-gemini format.
   */
  getFormatForModel(_model: string): FormatId {
    return 'google-gemini'
  }

  /**
   * Detect the format from an incoming wire request.
   * Google Gemini format detection.
   */
  getFormatForWireRequest(request: unknown): FormatId {
    if (this.isSupportedRequest(request)) {
      return 'google-gemini'
    }
    throw new Error('Unsupported request format for Gemini provider')
  }
}

export * from './types'
