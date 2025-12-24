/**
 * GeminiProvider - Complete Gemini GenerateContent API provider
 *
 * Handles bidirectional transformation between:
 * - GeminiRequest ↔ UnifiedRequest
 * - GeminiResponse ↔ UnifiedResponse
 * - Gemini SSE stream chunks ↔ UnifiedStreamChunk
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig } from '../base'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import { parseStreamChunk, transformStreamChunk } from './streaming'
import type { GeminiRequest, GeminiResponse } from './types'

export class GeminiProvider extends BaseProvider {
  readonly name = 'gemini' as const
  readonly config: ProviderConfig = {
    name: 'gemini',
    supportsStreaming: true,
    supportsThinking: true,
    supportsTools: true,
    defaultMaxTokens: 8192,
  }

  /**
   * Parse GeminiRequest into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest {
    return parse(request as GeminiRequest)
  }

  /**
   * Transform UnifiedRequest into GeminiRequest
   */
  transform(request: UnifiedRequest): GeminiRequest {
    return transform(request)
  }

  /**
   * Parse GeminiResponse into UnifiedResponse
   */
  parseResponse(response: unknown): UnifiedResponse {
    return parseResponse(response as GeminiResponse)
  }

  /**
   * Transform UnifiedResponse into GeminiResponse
   */
  transformResponse(response: UnifiedResponse): GeminiResponse {
    return transformResponse(response)
  }

  /**
   * Parse SSE stream chunk from Gemini format
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    return parseStreamChunk(chunk)
  }

  /**
   * Transform unified stream chunk to Gemini SSE format
   */
  transformStreamChunk(chunk: StreamChunk): string {
    return transformStreamChunk(chunk)
  }
}

// Export the provider class and types
export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
export * from './types'
