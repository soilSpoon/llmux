import type { StreamChunk, StreamDelta, UnifiedRequest, UnifiedResponse } from '../types/unified'

/**
 * Supported provider names
 */
export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'antigravity'
  | 'opencode-zen'
  | 'openai-web'

const VALID_PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'gemini',
  'antigravity',
  'opencode-zen',
  'openai-web',
] as const

export function isValidProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && VALID_PROVIDER_NAMES.includes(value as ProviderName)
}

/**
 * Type guard to check if a StreamDelta contains partial JSON
 */
export function isPartialJsonChunk(
  delta: StreamDelta | undefined
): delta is StreamDelta & { partialJson: string } {
  return (
    !!delta?.partialJson && typeof delta.partialJson === 'string' && delta.partialJson.length > 0
  )
}

/**
 * Type guard to check if a StreamChunk is a tool_call with partial JSON
 */
export function isToolCallWithPartialJson(
  chunk: StreamChunk
): chunk is StreamChunk & { delta: StreamDelta & { partialJson: string } } {
  return chunk.type === 'tool_call' && isPartialJsonChunk(chunk.delta)
}

/**
 * Stream parser type
 * - sse-standard: Events separated by double newline (\n\n)
 * - sse-line-delimited: Events separated by single newline (\n)
 */
export type StreamParserType = 'sse-standard' | 'sse-line-delimited'

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: ProviderName
  supportsStreaming: boolean
  supportsThinking: boolean
  supportsTools: boolean
  defaultMaxTokens?: number
  defaultStreamParser?: StreamParserType
}

/**
 * Provider interface - Each provider implements this for bidirectional transformation
 *
 * Flow:
 * 1. Source Request → parse() → UnifiedRequest
 * 2. UnifiedRequest → transform() → Target Request
 * 3. Target Response → parseResponse() → UnifiedResponse
 * 4. UnifiedResponse → transformResponse() → Source Response
 */
export interface Provider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  /**
   * Check if the request object is supported by this provider
   */
  isSupportedRequest(request: unknown): boolean

  /**
   * Check if the model name is supported by this provider
   */
  isSupportedModel(model: string): boolean

  /**
   * Parse provider-specific request format into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest

  /**
   * Transform UnifiedRequest into provider-specific request format
   */
  transform(request: UnifiedRequest, model: string): unknown

  /**
   * Parse provider-specific response format into UnifiedResponse
   */
  parseResponse(response: unknown): UnifiedResponse

  /**
   * Transform UnifiedResponse into provider-specific response format
   */
  transformResponse(response: UnifiedResponse): unknown

  /**
   * Parse a streaming chunk from provider format to unified format
   */
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null

  /**
   * Transform a unified stream chunk to provider format
   */
  transformStreamChunk?(chunk: StreamChunk): string | string[]
}

/**
 * Abstract base class for providers with common functionality
 */
export abstract class BaseProvider implements Provider {
  abstract readonly name: ProviderName
  abstract readonly config: ProviderConfig

  abstract isSupportedRequest(request: unknown): boolean
  abstract isSupportedModel(model: string): boolean

  abstract parse(request: unknown): UnifiedRequest
  abstract transform(request: UnifiedRequest, model: string): unknown
  abstract parseResponse(response: unknown): UnifiedResponse
  abstract transformResponse(response: UnifiedResponse): unknown

  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  transformStreamChunk?(chunk: StreamChunk): string | string[]
}
