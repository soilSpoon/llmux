/**
 * AI SDK Provider Implementation
 *
 * Implements the LanguageModelV3 interface from @ai-sdk/provider,
 * allowing llmux to be used as an AI SDK compatible provider.
 *
 * This is NOT a standard llmux Provider - it's an adapter that wraps llmux
 * functionality to be consumed by AI SDK functions like generateText, streamText.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import { parseStreamPart, transformStreamPart } from './streaming'
import { isAiSdkCallOptions } from './types'

/**
 * AI SDK Provider Configuration
 */
const AI_SDK_CONFIG: ProviderConfig = {
  // Note: 'ai-sdk' is not a standard ProviderName, but we extend it for this adapter
  name: 'openai' as ProviderName, // Use 'openai' as base since AI SDK format is OpenAI-like
  supportsStreaming: true,
  supportsThinking: true,
  supportsTools: true,
}

/**
 * AI SDK Provider implementation
 *
 * This provider handles bidirectional transformation between
 * AI SDK's LanguageModelV3 format and llmux's UnifiedRequest/Response.
 *
 * Unlike other providers (OpenAI, Anthropic, etc.), this is primarily
 * used for:
 * 1. Parsing AI SDK call options into UnifiedRequest
 * 2. Transforming UnifiedResponse back to AI SDK format
 *
 * This allows llmux to act as a backend for AI SDK applications.
 */
export class AiSdkProvider extends BaseProvider {
  readonly name: ProviderName = 'openai' as ProviderName // Compatibility name
  readonly config: ProviderConfig = AI_SDK_CONFIG

  isSupportedRequest(request: unknown): boolean {
    return isAiSdkCallOptions(request)
  }

  isSupportedModel(_model: string): boolean {
    // AI SDK adapter supports any model as it's just a protocol wrapper
    return true
  }

  /**
   * Parse AI SDK LanguageModelV3CallOptions into UnifiedRequest format.
   *
   * @param request - The AI SDK call options to parse
   * @returns The parsed UnifiedRequest
   * @throws Error if the request is invalid
   */
  parse(request: unknown): UnifiedRequest {
    if (!isAiSdkCallOptions(request)) {
      throw new Error('Invalid AI SDK request: must have prompt array')
    }
    return parse(request)
  }

  /**
   * Transform a UnifiedRequest into AI SDK LanguageModelV3CallOptions format.
   *
   * @param request - The UnifiedRequest to transform
   * @returns The AI SDK call options
   */
  transform(request: UnifiedRequest): LanguageModelV3CallOptions {
    return transform(request)
  }

  /**
   * Parse an AI SDK LanguageModelV3GenerateResult into UnifiedResponse format.
   *
   * @param response - The AI SDK generate result to parse
   * @returns The parsed UnifiedResponse
   * @throws Error if the response is invalid
   */
  parseResponse(response: unknown): UnifiedResponse {
    if (!response || typeof response !== 'object' || !('content' in response)) {
      throw new Error('Invalid AI SDK response: must have content array')
    }
    return parseResponse(response as LanguageModelV3GenerateResult)
  }

  /**
   * Transform a UnifiedResponse into AI SDK LanguageModelV3GenerateResult format.
   *
   * @param response - The UnifiedResponse to transform
   * @returns The AI SDK generate result
   */
  transformResponse(response: UnifiedResponse): LanguageModelV3GenerateResult {
    return transformResponse(response)
  }

  /**
   * Parse an AI SDK stream part into a unified StreamChunk.
   *
   * @param chunk - The raw chunk string (JSON)
   * @returns The parsed StreamChunk, or null if should be ignored
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    try {
      const parsed = JSON.parse(chunk)
      return parseStreamPart(parsed)
    } catch {
      return null
    }
  }

  /**
   * Transform a StreamChunk into AI SDK format.
   *
   * @param chunk - The StreamChunk to transform
   * @returns The JSON string
   */
  transformStreamChunk(chunk: StreamChunk): string {
    const part = transformStreamPart(chunk)
    if (!part) return ''
    return JSON.stringify(part)
  }
}

// Re-export for convenience
export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamPart, transformStreamPart } from './streaming'
export * from './types'
