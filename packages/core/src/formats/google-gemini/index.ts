import type { FormatId, SchemaFormat } from '../base'
import { buildWireRequest, parseRequest } from './request'
import { buildWireResponse, parseResponse } from './response'
import { buildStreamChunk, parseStreamChunk } from './streaming'
import { isGeminiRequest, isGeminiResponse, isGeminiStreamChunk } from './types'

export const GoogleGeminiFormat: SchemaFormat = {
  id: 'google-gemini' as FormatId,

  // WIRE-LEVEL TYPE GUARDS
  isSupportedWireRequest: isGeminiRequest,
  isSupportedWireResponse: isGeminiResponse,
  isSupportedStreamChunk(chunk: string): boolean {
    if (!chunk.startsWith('data: ')) return false
    try {
      const json = JSON.parse(chunk.slice(6))
      return isGeminiStreamChunk(json)
    } catch {
      return false
    }
  },

  // REQUEST TRANSFORMATION
  parseRequest,
  buildWireRequest: (unified, ctx) => buildWireRequest(unified, ctx),

  // RESPONSE TRANSFORMATION
  parseResponse,
  buildWireResponse: (unified, ctx) => buildWireResponse(unified, ctx),

  // STREAMING TRANSFORMATION
  parseStreamChunk,
  buildStreamChunk: (chunk, _ctx) => buildStreamChunk(chunk),

  // ERROR PARSING
  parseError(error: unknown): import('../../types/error').UnifiedError {
    const unifiedError: import('../../types/error').UnifiedError = {
      provider: 'google', // Default, will be overridden by caller
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
  },
}

export * from './request'
export * from './response'
export * from './streaming'
export * from './streaming-builder'
export * from './types'
