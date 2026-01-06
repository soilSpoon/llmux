import type { ProviderName } from '../providers/base'
import type { UnifiedError } from '../types/error'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'

/**
 * Supported schema format identifiers
 * - openai-chat: OpenAI Chat Completions API (/v1/chat/completions)
 * - openai-responses: OpenAI Responses API (/v1/responses)
 * - anthropic-messages: Anthropic Messages API (/v1/messages)
 * - google-gemini: Google Gemini API (/v1/models/{model}:generateContent)
 */
export type FormatId = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-gemini'

export interface FormatContext {
  provider: ProviderName
  model: string
}

export interface SchemaFormat {
  readonly id: FormatId

  // Wire-level type guards
  isSupportedWireRequest(request: unknown): boolean
  isSupportedWireResponse(response: unknown): boolean

  // Request
  parseRequest(request: unknown): UnifiedRequest
  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown

  // Response
  parseResponse(response: unknown): UnifiedResponse
  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown

  // Streaming
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  buildStreamChunk?(chunk: StreamChunk, ctx: FormatContext): string | string[]

  // Error Parsing
  parseError?(error: unknown): UnifiedError
}
