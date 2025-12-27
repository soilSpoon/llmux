import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'

/**
 * Supported provider names
 */
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'antigravity' | 'opencode-zen'

const VALID_PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'gemini',
  'antigravity',
  'opencode-zen',
] as const

export function isValidProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && VALID_PROVIDER_NAMES.includes(value as ProviderName)
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: ProviderName
  supportsStreaming: boolean
  supportsThinking: boolean
  supportsTools: boolean
  defaultMaxTokens?: number
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
   * Parse provider-specific request format into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest

  /**
   * Transform UnifiedRequest into provider-specific request format
   */
  transform(request: UnifiedRequest): unknown

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

  abstract parse(request: unknown): UnifiedRequest
  abstract transform(request: UnifiedRequest): unknown
  abstract parseResponse(response: unknown): UnifiedResponse
  abstract transformResponse(response: UnifiedResponse): unknown

  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  transformStreamChunk?(chunk: StreamChunk): string | string[]
}
