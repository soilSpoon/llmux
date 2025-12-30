/**
 * OpenAI Web Provider
 *
 * Provider implementation for OpenAI Web (ChatGPT) Backend API.
 * Uses the Responses API format (/v1/responses) at https://chatgpt.com/backend-api/codex
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
// Reuse OpenAI implementation logic (Responses API compatible)
import { parse, transform } from '../openai/request'
import { parseResponse, transformResponse } from '../openai/response'
import { parseStreamChunk, transformStreamChunk } from '../openai/streaming'
import {
  isOpenAIRequest,
  isOpenAIResponse,
  type OpenAIRequest,
  type OpenAIResponse,
} from '../openai/types'

/**
 * OpenAI Web Provider Configuration
 */
const OPENAI_WEB_CONFIG: ProviderConfig = {
  name: 'openai-web',
  supportsStreaming: true,
  supportsThinking: true, // Web backend uses Responses API which supports reasoning
  supportsTools: true,
}

/**
 * OpenAI Web Provider implementation
 *
 * Uses the same Responses API format as standard OpenAI, but authenticated
 * via ChatGPT OAuth and routed through chatgpt.com/backend-api/codex
 */
export class OpenAIWebProvider extends BaseProvider {
  readonly name: ProviderName = 'openai-web'
  readonly config: ProviderConfig = OPENAI_WEB_CONFIG

  private defaultModel: string = 'gpt-5.1'

  /**
   * Create a new OpenAI Web provider instance.
   *
   * @param options - Optional configuration
   */
  constructor(options?: { defaultModel?: string }) {
    super()
    if (options?.defaultModel) {
      this.defaultModel = options.defaultModel
    }
  }

  /**
   * Parse an OpenAI request into UnifiedRequest format.
   */
  parse(request: unknown): UnifiedRequest {
    if (!isOpenAIRequest(request)) {
      throw new Error('Invalid OpenAI request: must have model and messages')
    }
    return parse(request)
  }

  /**
   * Transform a UnifiedRequest into OpenAI Responses API format.
   * The /backend-api/codex endpoint uses the same format as /v1/responses
   */
  transform(request: UnifiedRequest, model?: string): OpenAIRequest {
    // Use standard OpenAI transformation - the /codex endpoint uses Responses API format
    return transform(request, model || this.defaultModel)
  }

  /**
   * Parse an OpenAI response into UnifiedResponse format.
   */
  parseResponse(response: unknown): UnifiedResponse {
    if (!isOpenAIResponse(response)) {
      throw new Error('Invalid OpenAI response: must have id, object, and choices')
    }
    return parseResponse(response)
  }

  /**
   * Transform a UnifiedResponse into OpenAI response format.
   */
  transformResponse(response: UnifiedResponse): OpenAIResponse {
    return transformResponse(response)
  }

  /**
   * Parse an OpenAI SSE streaming chunk.
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    return parseStreamChunk(chunk)
  }

  /**
   * Transform a StreamChunk into OpenAI SSE format.
   */
  transformStreamChunk(chunk: StreamChunk): string {
    return transformStreamChunk(chunk)
  }
}

// Re-export types for convenience
export * from '../openai/types'
