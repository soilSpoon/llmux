/**
 * OpenAI Provider
 *
 * Provider implementation for OpenAI Chat Completions API.
 * Handles bidirectional transformation between OpenAI format and unified format.
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { isChatCompletionsRequest } from './format-detector'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import { parseStreamChunk, transformStreamChunk } from './streaming'
import { isOpenAIRequest, isOpenAIResponse, type OpenAIRequest, type OpenAIResponse } from './types'

/**
 * OpenAI Provider Configuration
 */
const OPENAI_CONFIG: ProviderConfig = {
  name: 'openai',
  supportsStreaming: true,
  supportsThinking: true, // o1/o3 models support reasoning
  supportsTools: true,
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

  isSupportedModel(model: string): boolean {
    // Explicitly exclude models handled by openai-web
    if (model.startsWith('gpt-5') || model.includes('codex')) {
      return false
    }
    return (
      model.startsWith('gpt-') ||
      model.startsWith('o1') ||
      model.startsWith('o3') ||
      model.startsWith('o4')
    )
  }

  /**
   * Parse an OpenAI request into UnifiedRequest format.
   *
   * @param request - The OpenAI request to parse
   * @returns The parsed UnifiedRequest
   * @throws Error if the request is invalid
   */
  parse(request: unknown): UnifiedRequest {
    if (!isOpenAIRequest(request)) {
      throw new Error('Invalid OpenAI request: must have model and messages')
    }
    return parse(request)
  }

  /**
   * Transform a UnifiedRequest into OpenAI request format.
   *
   * @param request - The UnifiedRequest to transform
   * @param model - Model name to use
   * @returns The OpenAI request
   */
  transform(request: UnifiedRequest, model: string): OpenAIRequest {
    return transform(request, model)
  }

  /**
   * Parse an OpenAI response into UnifiedResponse format.
   *
   * @param response - The OpenAI response to parse
   * @returns The parsed UnifiedResponse
   * @throws Error if the response is invalid
   */
  parseResponse(response: unknown): UnifiedResponse {
    if (!isOpenAIResponse(response)) {
      throw new Error('Invalid OpenAI response: must have id, object, and choices')
    }
    return parseResponse(response)
  }

  /**
   * Transform a UnifiedResponse into OpenAI response format.
   *
   * @param response - The UnifiedResponse to transform
   * @returns The OpenAI response
   */
  transformResponse(response: UnifiedResponse): OpenAIResponse {
    return transformResponse(response)
  }

  /**
   * Parse an OpenAI SSE streaming chunk.
   *
   * @param chunk - The raw SSE chunk string
   * @returns The parsed StreamChunk, or null if should be ignored
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    return parseStreamChunk(chunk)
  }

  /**
   * Transform a StreamChunk into OpenAI SSE format.
   *
   * @param chunk - The StreamChunk to transform
   * @returns The SSE-formatted string
   */
  transformStreamChunk(chunk: StreamChunk): string {
    return transformStreamChunk(chunk)
  }
}

export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
// Re-export types and functions for convenience
export * from './types'
