/**
 * Antigravity Provider
 *
 * Provider implementation for Antigravity API wrapper format.
 * Antigravity wraps Gemini-style requests/responses with additional metadata.
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import { parseStreamChunk, transformStreamChunk } from './streaming'

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
      defaultMaxTokens: 8192,
      defaultStreamParser: 'sse-line-delimited',
    }
  }

  /**
   * Parse an Antigravity request into UnifiedRequest format.
   */
  parse(request: unknown): UnifiedRequest {
    return parse(request)
  }

  /**
   * Transform a UnifiedRequest into Antigravity request format.
   */
  transform(request: UnifiedRequest): unknown {
    return transform(request)
  }

  /**
   * Parse an Antigravity response into UnifiedResponse format.
   */
  parseResponse(response: unknown): UnifiedResponse {
    return parseResponse(response)
  }

  /**
   * Transform a UnifiedResponse into Antigravity response format.
   */
  transformResponse(response: UnifiedResponse): unknown {
    return transformResponse(response)
  }

  /**
   * Parse an Antigravity SSE stream chunk into unified format.
   */
  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseStreamChunk(chunk)
  }

  /**
   * Transform a unified stream chunk to Antigravity SSE format.
   */
  transformStreamChunk(chunk: StreamChunk): string {
    return transformStreamChunk(chunk)
  }
}

// Re-export types and functions for convenience
export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
export * from './types'
