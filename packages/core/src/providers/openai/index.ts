/**
 * OpenAI Provider
 *
 * Provider implementation for OpenAI Chat Completions API.
 * Handles bidirectional transformation between OpenAI format and unified format.
 */

import type { FormatId } from '../../formats/base'
import { getFormat } from '../../formats/registry'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { isChatCompletionsRequest } from './format-detector'
import { isOpenAIRequest, isOpenAIResponse, type OpenAIRequest, type OpenAIResponse } from './types'

/**
 * OpenAI Provider Configuration
 */
const OPENAI_CONFIG: ProviderConfig = {
  name: 'openai',
  supportsStreaming: true,
  supportsThinking: true, // o1/o3 models support reasoning
  supportsTools: true,
  authType: 'apiKey',
}

/**
 * OpenAI Provider implementation
 */
export class OpenAIProvider extends BaseProvider {
  readonly name: ProviderName = 'openai'
  readonly config: ProviderConfig = OPENAI_CONFIG

  isSupportedRequest(request: unknown): boolean {
    if (!isOpenAIRequest(request)) return false
    // Anthropic requests have top-level system property
    if (typeof request === 'object' && request !== null && 'system' in request) return false
    return isChatCompletionsRequest(request)
  }

  /**
   * Parse an OpenAI request into UnifiedRequest format.
   *
   * @param request - The OpenAI request to parse
   * @returns The parsed UnifiedRequest
   * @throws Error if the request is invalid
   */
  parse(request: unknown): UnifiedRequest {
    const format = getFormat('openai-chat')
    if (!isOpenAIRequest(request)) {
      throw new Error('Invalid OpenAI request: must have model and messages')
    }
    return format.parseRequest(request)
  }

  /**
   * Transform a UnifiedRequest into OpenAI request format.
   *
   * @param request - The UnifiedRequest to transform
   * @param model - Model name to use
   * @returns The OpenAI request
   */
  transform(request: UnifiedRequest, model: string): OpenAIRequest {
    const format = getFormat('openai-chat')
    return format.buildWireRequest(request, {
      model,
      provider: this.name,
    }) as OpenAIRequest
  }

  /**
   * Parse an OpenAI response into UnifiedResponse format.
   *
   * @param response - The OpenAI response to parse
   * @returns The parsed UnifiedResponse
   * @throws Error if the response is invalid
   */
  parseResponse(response: unknown): UnifiedResponse {
    const format = getFormat('openai-chat')
    if (!isOpenAIResponse(response)) {
      throw new Error('Invalid OpenAI response: must have id, object, and choices')
    }
    return format.parseResponse(response)
  }

  /**
   * Transform a UnifiedResponse into OpenAI response format.
   *
   * @param response - The UnifiedResponse to transform
   * @returns The OpenAI response
   */
  transformResponse(response: UnifiedResponse): OpenAIResponse {
    const format = getFormat('openai-chat')
    return format.buildWireResponse(response, {
      model: '', // Context not needed for response transformation
      provider: this.name,
    }) as OpenAIResponse
  }

  /**
   * Parse an OpenAI SSE streaming chunk.
   *
   * @param chunk - The raw SSE chunk string
   * @returns The parsed StreamChunk, or null if should be ignored
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    const format = getFormat('openai-chat')
    if (!format.parseStreamChunk) {
      throw new Error('Format openai-chat does not support parsing stream chunks')
    }
    const result = format.parseStreamChunk(chunk)
    // format.parseStreamChunk can return array, single, or null.
    // OpenAI provider currently expects single or null.
    // For now, if array, take first item (unlikely to happen with simple chunks)
    if (Array.isArray(result)) {
      return result[0] || null
    }
    return result
  }

  /**
   * Transform a StreamChunk into OpenAI SSE format.
   *
   * @param chunk - The StreamChunk to transform
   * @returns The SSE-formatted string
   */
  transformStreamChunk(chunk: StreamChunk): string {
    const format = getFormat('openai-chat')
    if (!format.buildStreamChunk) {
      throw new Error('Format openai-chat does not support building stream chunks')
    }
    const result = format.buildStreamChunk(chunk, {
      model: '', // Context not needed for stream chunk transformation
      provider: this.name,
    })
    // format.buildStreamChunk can return array or string
    if (Array.isArray(result)) {
      return result.join('')
    }
    return result
  }

  /**
   * Get the schema format ID for this provider's models.
   * OpenAI provider always uses openai-chat format.
   */
  getFormatForModel(_model: string): FormatId {
    return 'openai-chat'
  }

  /**
   * Detect the format from an incoming wire request.
   * OpenAI Chat format detection.
   */
  getFormatForWireRequest(request: unknown): FormatId {
    if (this.isSupportedRequest(request)) {
      return 'openai-chat'
    }
    throw new Error('Unsupported request format for OpenAI provider')
  }

  /**
   * Parse an OpenAI error into UnifiedError
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
      // Handle OpenAI standard error format: { error: { message, type, code, param } }
      const errorObj = (err.error || err) as Record<string, unknown>

      unifiedError.message = String(errorObj.message || error)
      unifiedError.providerCode = String(errorObj.code || '')

      if (typeof errorObj.status === 'number') {
        unifiedError.statusCode = errorObj.status
      }

      // Map common OpenAI error codes/types
      const errorType = errorObj.type
      const errorCode = errorObj.code

      if (errorType === 'invalid_request_error') {
        unifiedError.code = 'invalid_request_error'
      } else if (errorType === 'authentication_error') {
        unifiedError.code = 'authentication_error'
      } else if (errorType === 'permission_error') {
        unifiedError.code = 'permission_error'
      } else if (errorType === 'rate_limit_error' || errorCode === 'rate_limit_exceeded') {
        unifiedError.code = 'rate_limit_error'
        unifiedError.retryable = true
      } else if (
        errorType === 'server_error' ||
        (unifiedError.statusCode && unifiedError.statusCode >= 500)
      ) {
        unifiedError.code = 'server_error'
        unifiedError.retryable = true
      } else if (errorCode === 'context_length_exceeded') {
        unifiedError.code = 'context_length_exceeded'
      }
    } else {
      unifiedError.message = String(error)
    }

    return unifiedError
  }
}

export * from './types'
