import type { UnifiedError } from '../types/error'
import type { ProviderName } from '../types/providers'
import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../types/unified'

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

/**
 * SchemaFormat - Interface for provider API schema transformations
 *
 * Formats are the source of truth for wire-level schemas (request/response/streaming/errors).
 * Each format implementation handles parsing and building for a specific API schema.
 *
 * Design principles:
 * - Formats own all parsing/transformation logic (not providers)
 * - One format can be used by multiple providers (e.g., google-gemini used by Gemini, Google, Antigravity)
 * - One provider can use multiple formats (e.g., OpenCodeZen routes to different formats per model)
 * - Formats cannot import from providers; providers import from formats
 *
 * Streaming vs Non-Streaming:
 * - Non-streaming: Use parseResponse/buildWireResponse for complete response objects
 * - Streaming: Use parseStreamChunk/buildStreamChunk for incremental SSE delta chunks
 *
 * Inspired by:
 * - LiteLLM: BaseConfig with transform_request/transform_response methods
 * - Vercel AI SDK: LanguageModelV3 with doGenerate/doStream separation
 */
export interface SchemaFormat {
  readonly id: FormatId

  // ═══════════════════════════════════════════════════════════════════════════════
  // WIRE-LEVEL TYPE GUARDS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if the given object is a valid wire-format request for this schema.
   */
  isSupportedWireRequest(request: unknown): boolean

  /**
   * Check if the given object is a valid wire-format response for this schema.
   */
  isSupportedWireResponse(response: unknown): boolean

  /**
   * Check if the given SSE data string is a valid stream chunk for this schema.
   * Used for stream validation and routing in multi-format scenarios.
   *
   * @param chunk - Raw SSE data string (after "data: " prefix is stripped)
   * @returns true if this format can parse the chunk
   */
  isSupportedStreamChunk?(chunk: string): boolean

  // ═══════════════════════════════════════════════════════════════════════════════
  // REQUEST TRANSFORMATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a wire-format request into unified format.
   *
   * @param request - Raw wire-format request object
   * @returns Unified request representation
   */
  parseRequest(request: unknown): UnifiedRequest

  /**
   * Build a wire-format request from unified format.
   *
   * @param unified - Unified request to transform
   * @param ctx - Format context with provider and model info
   * @returns Wire-format request for this schema
   */
  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESPONSE TRANSFORMATION (Non-Streaming)
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // These methods handle COMPLETE response objects, not streaming chunks.
  // Use for non-streaming API calls or accumulated streaming results.
  //
  // Similar to Vercel AI SDK's doGenerate() which returns complete responses.
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a COMPLETE wire-format response into unified format.
   *
   * Use this for non-streaming API responses or after accumulating all stream chunks.
   * Do NOT use for individual streaming chunks - use parseStreamChunk instead.
   *
   * @param response - Complete wire-format response object
   * @returns Unified response representation
   */
  parseResponse(response: unknown): UnifiedResponse

  /**
   * Build a COMPLETE wire-format response from unified format.
   *
   * Use this for constructing non-streaming API responses.
   * Do NOT use for streaming chunks - use buildStreamChunk instead.
   *
   * @param unified - Unified response to transform
   * @param ctx - Format context with provider and model info
   * @returns Complete wire-format response for this schema
   */
  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown

  // ═══════════════════════════════════════════════════════════════════════════════
  // STREAMING TRANSFORMATION
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // These methods handle INCREMENTAL streaming chunks (SSE delta events).
  // Use for real-time streaming of partial content.
  //
  // Similar to Vercel AI SDK's doStream() which yields LanguageModelV3StreamPart
  // with *-start/*-delta/*-end patterns for precise state tracking.
  //
  // StreamChunk uses UnifiedStreamChunkType for granular event types:
  // - text-delta: Incremental text content
  // - tool-call-start/tool-input-delta/tool-call-end: Tool call lifecycle
  // - thinking-start/thinking-delta/thinking-end: Thinking block lifecycle
  // - usage: Token usage update
  // - finish: Stream completion with FinishReason (unified + raw)
  // - error: Error during streaming
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a STREAMING chunk from wire format into unified StreamChunk.
   *
   * Use this for individual SSE events during streaming.
   * May return multiple chunks if the wire format batches events.
   * Returns null for SSE events that should be ignored (comments, keep-alive, etc.)
   *
   * @param chunk - Raw SSE data string (after "data: " prefix is stripped)
   * @returns StreamChunk, array of chunks, or null to skip
   */
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null

  /**
   * Build a STREAMING chunk in wire format from unified StreamChunk.
   *
   * Use this for constructing SSE events during streaming.
   * May return multiple strings if the format requires multiple SSE events.
   *
   * @param chunk - Unified stream chunk to transform
   * @param ctx - Format context with provider and model info
   * @returns Wire-format SSE data string(s) (without "data: " prefix)
   *
   * @deprecated Use getStreamingPipeline().build() instead for stateful transformations
   */
  buildStreamChunk?(chunk: StreamChunk, ctx: FormatContext): string | string[]

  /**
   * Get the streaming pipeline for stateful SSE transformations.
   *
   * Stateful streaming requires maintaining state across multiple SSE events:
   * - Auto-emitting message_start on first content block (Anthropic)
   * - Filtering duplicate events from transformations
   * - Emitting final cleanup events (e.g., block_stop)
   *
   * @param ctx - Format context with provider and model info
   * @returns StreamingPipeline instance for handling streaming transformations
   *
   * Optional - implement if format requires stateful streaming logic.
   *
   * Example (Anthropic Messages):
   *   - Parses Anthropic SSE events → Unified StreamChunk
   *   - Builds Unified StreamChunk → Anthropic SSE with auto-generated message_start
   *   - Filters out duplicate message_start events
   *   - Flushes final block_stop when stream ends
   */
  getStreamingPipeline?(ctx: FormatContext): StreamingPipeline

  // ═══════════════════════════════════════════════════════════════════════════════
  // ERROR PARSING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Parse a provider-specific error into unified error format.
   *
   * @param error - Raw error response from the provider
   * @returns Unified error representation
   */
  parseError?(error: unknown): UnifiedError
}
