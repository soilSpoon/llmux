/**
 * OpenAI Web Provider
 *
 * Provider implementation for OpenAI Web (ChatGPT) Backend API.
 * Uses the Responses API format (/v1/responses) at https://chatgpt.com/backend-api/codex
 */

import type { FormatId } from '../../formats/base'
import type { OpenAIResponsesRequest } from '../../formats/openai-responses/types'
import { getFormat } from '../../formats/registry'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { isResponsesApiRequest } from '../openai/format-detector'
import { isOpenAIRequest, type OpenAIResponse } from '../openai/types'

/**
 * OpenAI Web Provider Configuration
 */
const OPENAI_WEB_CONFIG: ProviderConfig = {
  name: 'openai-web',
  supportsStreaming: true,
  supportsThinking: true, // Web backend uses Responses API which supports reasoning
  supportsTools: true,
  authType: 'oauth',
}

/**
 * OpenAI Web Provider implementation
 *
 * Uses the same Responses API format as standard OpenAI, but authenticated
 * via ChatGPT OAuth and routed through chatgpt.com/backend-api/codex
 *
 * NOTE: Instruction validation and injection is handled by the server package's
 * buildCodexBody function, which fetches instructions from GitHub.
 */
export class OpenAIWebProvider extends BaseProvider {
  readonly name: ProviderName = 'openai-web'
  readonly config: ProviderConfig = OPENAI_WEB_CONFIG

  isSupportedRequest(request: unknown): boolean {
    return isOpenAIRequest(request) && isResponsesApiRequest(request)
  }

  /**
   * Parse an OpenAI request into UnifiedRequest format.
   */
  parse(request: unknown): UnifiedRequest {
    return getFormat('openai-responses').parseRequest(request)
  }

  /**
   * Transform a UnifiedRequest into OpenAI Responses API format.
   * The /backend-api/codex endpoint uses the same format as /v1/responses
   *
   * NOTE: Final instruction validation is handled by server's buildCodexBody
   */
  transform(request: UnifiedRequest, model: string): OpenAIResponsesRequest {
    return getFormat('openai-responses').buildWireRequest(request, {
      model,
      provider: this.name,
    }) as OpenAIResponsesRequest
  }

  /**
   * Parse an OpenAI response into UnifiedResponse format.
   */
  parseResponse(response: unknown): UnifiedResponse {
    return getFormat('openai-responses').parseResponse(response)
  }

  /**
   * Transform a UnifiedResponse into OpenAI response format.
   */
  transformResponse(response: UnifiedResponse): OpenAIResponse {
    return getFormat('openai-responses').buildWireResponse(response, {
      model: response.model || 'unknown',
      provider: this.name,
    }) as OpenAIResponse
  }

  /**
   * Parse an OpenAI Responses API SSE streaming chunk.
   */
  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    const format = getFormat('openai-responses')
    if (!format.parseStreamChunk) {
      throw new Error('openai-responses format missing parseStreamChunk')
    }
    return format.parseStreamChunk(chunk)
  }

  /**
   * Transform a StreamChunk into OpenAI SSE format.
   */
  transformStreamChunk(chunk: StreamChunk): string {
    const format = getFormat('openai-responses')
    if (!format.buildStreamChunk) {
      throw new Error('openai-responses format missing buildStreamChunk')
    }
    const result = format.buildStreamChunk(chunk, {
      model: 'unknown',
      provider: this.name,
    })
    return Array.isArray(result) ? result.join('\n') : result
  }

  /**
   * Get the schema format ID for this provider's models.
   * OpenAI Web uses the openai-responses format.
   */
  getFormatForModel(_model: string): FormatId {
    return 'openai-responses'
  }

  /**
   * Detect the format from an incoming wire request.
   * OpenAI Responses format detection.
   */
  getFormatForWireRequest(request: unknown): FormatId {
    if (this.isSupportedRequest(request)) {
      return 'openai-responses'
    }
    throw new Error('Unsupported request format for OpenAI Web provider')
  }
}

// Re-export types for convenience
export * from '../openai/types'
