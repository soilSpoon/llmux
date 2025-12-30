/**
 * Anthropic Provider
 *
 * Implements the Provider interface for Anthropic Claude API
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import type { ProviderConfig, ProviderName } from '../base'
import { BaseProvider } from '../base'
import { parse, transform } from './request'
import { parseResponse, transformResponse } from './response'
import {
  parseStreamChunk as parseStream,
  transformStreamChunk as transformStream,
} from './streaming'
import type { AnthropicRequest, AnthropicResponse } from './types'
import { isAnthropicResponse } from './types'

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
      defaultMaxTokens: 4096,
    }
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
}

export { parse, transform } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
// Re-export types and functions for convenience
export * from './types'
