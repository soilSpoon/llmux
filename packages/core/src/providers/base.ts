import type { FormatId } from '../formats/base'
import type { StreamChunk, StreamDelta, UnifiedRequest, UnifiedResponse } from '../types'
import type { UnifiedError } from '../types/error'

/**
 * Supported provider names
 */
export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'gemini-cli'
  | 'antigravity'
  | 'opencode-zen'
  | 'openai-web'
  | 'github-copilot'
  | 'google'

const VALID_PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'gemini',
  'gemini-cli',
  'antigravity',
  'opencode-zen',
  'openai-web',
  'google',
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
 * Authentication type for providers
 * - oauth: Uses OAuth/session-based authentication (e.g., ChatGPT, GitHub Copilot)
 * - apiKey: Uses API key authentication (e.g., OpenAI API, Anthropic API)
 */
export type AuthType = 'oauth' | 'apiKey'

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: ProviderName
  supportsStreaming: boolean
  supportsThinking: boolean
  supportsTools: boolean
  authType?: AuthType
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
   * Parse provider-specific request format into UnifiedRequest
   */
  parse(request: unknown): UnifiedRequest

  /**
   * Transform UnifiedRequest into provider-specific request format
   */
  transform(request: UnifiedRequest, model: string): unknown

  /**
   * Parse provider-specific response format into UnifiedResponse
   * @param response - The provider-specific response
   * @param model - Optional model name for format detection in hybrid providers
   */
  parseResponse(response: unknown, model?: string): UnifiedResponse

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

  /**
   * Parse a provider error into UnifiedError
   * @param error The raw error object from the provider
   */
  parseError(error: unknown): UnifiedError

  /**
   * Get the schema format ID for a specific model.
   * Returns the format used when transforming to wire format for this model.
   */
  getFormatForModel?(model: string): FormatId

  /**
   * Get the schema format ID for a wire request.
   * Detects the format from an incoming request object.
   */
  getFormatForWireRequest?(request: unknown): FormatId
}

/**
 * Abstract base class for providers with common functionality
 */
export abstract class BaseProvider implements Provider {
  abstract readonly name: ProviderName
  abstract readonly config: ProviderConfig

  abstract isSupportedRequest(request: unknown): boolean

  abstract parse(request: unknown): UnifiedRequest
  abstract transform(request: UnifiedRequest, model: string): unknown
  abstract parseResponse(response: unknown, model?: string): UnifiedResponse
  abstract transformResponse(response: UnifiedResponse): unknown

  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  transformStreamChunk?(chunk: StreamChunk): string | string[]

  // Optional format methods - to be implemented by providers during refactoring
  getFormatForModel?(model: string): FormatId
  getFormatForWireRequest?(request: unknown): FormatId

  /**
   * Default error parser implementation.
   * Providers should override this to provide more specific error mapping.
   */
  parseError(error: unknown): UnifiedError {
    const message = error instanceof Error ? error.message : String(error)
    return {
      provider: this.name,
      code: 'unknown_error',
      message,
      retryable: false,
      originalError: error,
    }
  }
}
