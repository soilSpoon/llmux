/**
 * UnifiedRequest - Central hub format for all provider transformations
 */
export interface UnifiedRequest {
  messages: UnifiedMessage[]
  system?: string
  systemBlocks?: SystemBlock[] // Preserves cache_control for Anthropic
  tools?: UnifiedTool[]
  toolChoice?: UnifiedToolChoice // Tool selection mode
  config?: GenerationConfig
  thinking?: ThinkingConfig
  userRole?: string // User role for Antigravity (user_role)
  metadata?: RequestMetadata
  stream?: boolean // Preserves stream parameter
}

/**
 * UnifiedToolChoice - Unified tool selection mode
 * Maps between providers:
 * - Anthropic: tool_choice: {type: "auto"|"any"|"tool", name?: string}
 * - OpenAI: tool_choice: "auto"|"none"|"required"|{type: "function", function: {name: string}}
 * - Gemini/Antigravity: toolConfig.functionCallingConfig.mode + allowedFunctionNames
 */
export type UnifiedToolChoice =
  | 'auto' // Let the model decide
  | 'none' // Don't use tools
  | 'required' // Must use a tool (any tool)
  | { type: 'tool'; name: string } // Must use a specific tool

/**
 * UnifiedResponse - Central hub format for all provider response transformations
 */
export interface UnifiedResponse {
  id: string
  content: ContentPart[]
  stopReason: StopReason
  usage?: UsageInfo
  model?: string
  thinking?: ThinkingBlock[]
  metadata?: ResponseMetadata
}

/**
 * UnifiedMessage - Represents a single message in the conversation
 */
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'tool'
  parts: ContentPart[]
}

/**
 * ContentPart - Union type for all content block types
 */
export interface ContentPart {
  type: 'text' | 'image' | 'tool_call' | 'tool_result' | 'thinking'

  text?: string
  image?: ImageData
  toolCall?: ToolCall
  toolResult?: ToolResult
  thinking?: ThinkingBlock
  cacheControl?: CacheControl // Preserves Anthropic cache_control

  /**
   * Signature for thinking process verification (e.g., Gemini thoughtSignature).
   * Can be attached to any part type (thinking, tool_call, text, etc.)
   */
  thoughtSignature?: string
}

/**
 * ImageData - Image content with inline data or URL
 */
export interface ImageData {
  mimeType: string
  data?: string
  url?: string
}

/**
 * ToolCall - Represents a tool/function call
 */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown> | string
}

/**
 * ToolResult - Represents a tool/function result
 */
export interface ToolResult {
  toolCallId: string
  content: string | ContentPart[]
  isError?: boolean
}

/**
 * ThinkingBlock - Represents extended thinking/reasoning content
 */
export interface ThinkingBlock {
  text: string
  signature?: string
  signatureValid?: boolean
  /** True if this thinking block was redacted (e.g., Anthropic redacted_thinking) */
  redacted?: boolean
}

/**
 * GenerationConfig - Common generation parameters
 */
export interface GenerationConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  stopSequences?: string[]

  // Extended OpenAI-compatible fields
  logprobs?: number | boolean
  responseFormat?: 'json' | 'json_schema' | Record<string, unknown>
  serviceTier?: 'auto' | 'flex' | 'priority'
  parallelToolCalls?: boolean
  maxToolCalls?: number
  store?: boolean

  // Provider-agnostic
  promptCacheKey?: string
}

/**
 * ThinkingConfig - Extended thinking/reasoning configuration
 * Unified configuration for thinking/reasoning across different providers
 */
export interface ThinkingConfig {
  enabled: boolean
  budget?: number
  effort?: 'none' | 'low' | 'medium' | 'high'
  level?: 'minimal' | 'low' | 'medium' | 'high' // Gemini 3 specific
  preserveContext?: boolean // GLM clear_thinking 반대
  includeThoughts?: boolean
}

/**
 * CacheControl - Anthropic cache control metadata
 */
export interface CacheControl {
  type: string
  ttl?: string
}

/**
 * SystemBlock - System prompt block with cache control support
 */
export interface SystemBlock {
  type: 'text'
  text: string
  cacheControl?: CacheControl
}

/**
 * RequestMetadata - Additional request metadata
 */
export interface RequestMetadata {
  // Common metadata
  userId?: string
  sessionId?: string
  conversationId?: string
  user?: string // OpenAI user identifier
  promptCacheKey?: string // For centralized caching

  // Timestamps
  createTime?: string // Gemini createTime
  createdAt?: number
  completedAt?: number | null

  // Previously required, but making optional for compatibility with tests/partial updates
  project?: string
  userAgent?: string
  requestType?: string
  requestId?: string

  // Antigravity / Google Cloud specific
  duetProject?: string
  ideType?: string
  platform?: string
  pluginType?: string

  // OpenAI specific
  serviceTier?: string
  parallelToolCalls?: boolean

  // Other observed fields
  model?: string
  customField?: unknown // For tests
}

/**
 * UsageInfo - Token usage information
 */
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  thinkingTokens?: number
  cachedTokens?: number // Kept for backward compatibility
  cacheReadTokens?: number // Explicit read tokens
  cacheWriteTokens?: number // Explicit write tokens
  /** Amp-specific: Logical credit consumption */
  credits?: number
}

/**
 * StopReason - Reason for generation completion (unified)
 */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'stop_sequence'
  | 'content_filter'
  | 'error'
  | null

/**
 * FinishReason - Reason for generation completion with raw provider value
 * Inspired by Vercel AI SDK's LanguageModelV3FinishReason
 *
 * Preserves both the unified reason for consistent handling and the raw
 * provider-specific value for debugging and provider-specific logic.
 */
export interface FinishReason {
  /**
   * Unified finish reason that works across all providers.
   * Maps provider-specific values to a consistent set of reasons.
   */
  unified: StopReason

  /**
   * Raw provider-specific finish reason string.
   * Examples:
   * - OpenAI: "stop", "length", "tool_calls", "content_filter"
   * - Anthropic: "end_turn", "max_tokens", "tool_use", "stop_sequence"
   * - Gemini: "STOP", "MAX_TOKENS", "SAFETY", "RECITATION"
   */
  raw: string
}

/**
 * UnifiedTool - Tool/function definition
 */
export interface UnifiedTool {
  name: string
  description?: string
  parameters: JSONSchema
  custom?: Record<string, unknown> // For tools with custom input_schema (e.g., OpenCode format)
}

/**
 * JSONSchema - Simplified JSON Schema for tool parameters
 */
export interface JSONSchema {
  [key: string]: unknown // Allow additional JSON Schema keywords
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  description?: string
  items?: JSONSchemaProperty
  enum?: (string | number | boolean)[]
  additionalProperties?: boolean | JSONSchemaProperty
}

/**
 * JSONSchemaProperty - Individual property in a JSON Schema
 */
export interface JSONSchemaProperty {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
  description?: string
  enum?: (string | number | boolean | null)[]
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  additionalProperties?: boolean | JSONSchemaProperty
  anyOf?: JSONSchemaProperty[]
  oneOf?: JSONSchemaProperty[]
  allOf?: JSONSchemaProperty[]
}

/**
 * UnifiedResponseMetadata - Response-level metadata for lossless streaming transformation
 *
 * Captures all fields from response.created/response.in_progress SSE events.
 * Design principle: No rawResponse - all fields are explicitly typed.
 *
 * This is the unified format used across the system, using camelCase.
 */
export interface ResponseMetadata {
  [key: string]: unknown // Allow any additional fields for lossless round-trip
  responseId?: string
  id?: string // Alias for responseId
  object?: 'response' | string
  status?: 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'incomplete'
  model?: string
  createdAt?: number
  created_at?: number // Alias for createdAt (snake_case)
  completedAt?: number | null
  completed_at?: number | null // Alias for completedAt (snake_case)

  background?: boolean
  instructions?: string
  obfuscation?: boolean | { type: string; reason?: string }

  temperature?: number
  top_p?: number // For round-trip
  topP?: number
  max_output_tokens?: number // For round-trip
  maxOutputTokens?: number
  parallel_tool_calls?: boolean // For round-trip
  parallelToolCalls?: boolean
  store?: boolean
  prompt_cache_key?: string // For round-trip
  promptCacheKey?: string
  truncation?: 'auto' | 'disabled'
  top_logprobs?: number // For round-trip
  topLogprobs?: number
  service_tier?: string // For round-trip
  serviceTier?: 'auto' | 'default' | 'flex' | 'priority' | string
  safety_identifier?: string // For round-trip
  safetyIdentifier?: string
  max_tool_calls?: number | null // For round-trip
  maxToolCalls?: number | null
  previousResponseId?: string | null
  previous_response_id?: string | null // For round-trip
  promptCacheRetention?: number | null
  prompt_cache_retention?: number | null // For round-trip

  tools?: Array<{
    type: string
    name?: string
    description?: string
    parameters?: Record<string, unknown> | JSONSchema
  }>
  tool_choice?: string | { type: string; name?: string }

  toolChoice?:
    | 'auto'
    | 'none'
    | 'required'
    | string
    | { type: string; name?: string; function?: { name: string } }

  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: Record<string, number>
    output_tokens_details?: Record<string, number>
    [key: string]: unknown
  }

  reasoning?: {
    enabled?: boolean
    effort?: 'none' | 'low' | 'medium' | 'high'
    summary?: 'auto' | 'concise' | 'detailed' | 'none'
    maxTokens?: number
    budget?: number
    max_tokens?: number // For backward compatibility with some internal clones
  }

  text?: {
    format?: {
      type?: 'text' | 'json_object' | 'json_schema' | string
      schema?: JSONSchema
    }
    verbosity?: string
  }

  output?: unknown[]
  input?: string[]

  error?: {
    message?: string
    code?: string
    type?: string
  } | null

  incompleteDetails?: {
    reason?: 'max_output_tokens' | 'time' | 'content_filter' | 'stop' | string
  } | null

  metadata?: Record<string, unknown>
  user?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAMING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UnifiedStreamChunkType - Granular stream chunk types
 *
 * Inspired by Vercel AI SDK's LanguageModelV3StreamPart pattern with *-start/*-delta/*-end.
 * Enables better state tracking than simple delta-only streaming.
 *
 * Types:
 * - text-delta: Incremental text content
 * - tool-call-start: Start of a tool call (includes id, name)
 * - tool-input-delta: Incremental tool input JSON
 * - tool-call-end: End of a tool call
 * - thinking-start: Start of thinking block
 * - thinking-delta: Incremental thinking content
 * - thinking-end: End of thinking block
 * - usage: Token usage update
 * - finish: Stream completion with finish reason
 * - error: Error during streaming
 */
export type UnifiedStreamChunkType =
  // Text content
  | 'text-delta'
  // Tool calls (start/delta/end pattern)
  | 'tool-call-start'
  | 'tool-input-delta'
  | 'tool-call-end'
  // Thinking blocks (start/delta/end pattern)
  | 'thinking-start'
  | 'thinking-delta'
  | 'thinking-end'
  // Meta events
  | 'usage'
  | 'finish'
  | 'error'

/**
 * StreamChunk - Represents a single streaming chunk
 *
 * This is the format-agnostic unified stream representation.
 * Formats parse provider-specific SSE events into these chunks.
 *
 * Multi-block streaming support:
 * - blockIndex: 0-based index identifying which content block this chunk belongs to
 * - blockType: The type of content block (text, tool_call, thinking, etc.)
 *
 * Granular stream types:
 * - Uses UnifiedStreamChunkType for Vercel AI SDK-style *-start/*-delta/*-end pattern
 * - Enables precise state tracking for complex content like tool calls and thinking
 */
export interface StreamChunk {
  /**
   * Granular chunk type for precise streaming state tracking.
   *
   * Use UnifiedStreamChunkType values like 'text-delta', 'tool-call-start',
   * 'tool-input-delta', 'thinking-delta', 'finish', etc.
   *
   * Legacy types ('content', 'tool_call', etc.) are supported for backward compatibility.
   */
  type:
    | UnifiedStreamChunkType
    // Legacy types for backward compatibility
    | 'content'
    | 'tool_call'
    | 'tool_result'
    | 'thinking'
    | 'block_stop'
    | 'done'

  id?: string

  /** 0-based block index for multi-block streaming (defaults to 0 for single-block providers) */
  blockIndex?: number

  /** Type of the content block this chunk belongs to */
  blockType?: ContentPart['type']

  delta?: StreamDelta
  usage?: UsageInfo

  /**
   * Finish reason with both unified and raw values.
   * For 'finish' type chunks, provides detailed stop reason information.
   */
  finishReason?: FinishReason

  /** @deprecated Use finishReason.unified instead */
  stopReason?: StopReason

  error?: string

  /**
   * Response metadata from OpenAI Responses API events.
   * Captured from response.created and response.in_progress events to preserve
   * all original response fields including instructions, obfuscation, etc.
   */
  responseMetadata?: ResponseMetadata
  model?: string

  /**
   * For 'done'/'finish' chunks: if true, skip emitting the stop reason delta.
   * Used when the stop reason was already emitted in a previous chunk.
   */
  skipStopDelta?: boolean

  /**
   * Sequence number from OpenAI Responses API events.
   * Used to maintain strict event ordering and detect dropped chunks.
   */
  sequenceNumber?: number

  /**
   * Obfuscation flag from OpenAI Responses API events.
   * Indicates if the content is obfuscated (e.g. for PII).
   */
  obfuscation?: boolean | { type: string; reason?: string }

  /**
   * Log probabilities from OpenAI Responses API events.
   * Token-level log probability information.
   */
  logprobs?: unknown[]

  /**
   * Tool call metadata for 'tool-call-start' and 'tool-call-end' events.
   * Contains the tool call ID and name (name only available at start).
   */
  toolCall?: {
    id: string
    name?: string
  }

  /**
   * Summary index for reasoning summary parts (OpenAI Responses API).
   * Used to maintain canonical equivalence for reasoning blocks.
   */
  summaryIndex?: number

  /**
   * Content index for text parts (OpenAI Responses API).
   * Used to maintain canonical equivalence for text blocks.
   */
  contentIndex?: number
}

/**
 * StreamDelta - Partial content updates in a stream chunk
 *
 * Extends ContentPart with streaming-specific fields like partialJson
 * for accumulating tool input across multiple stream events.
 */
export interface StreamDelta extends Partial<ContentPart> {
  /**
   * Streamed partial JSON for tool input accumulation
   *
   * When a tool call's arguments are streamed (e.g., input_json_delta in Anthropic,
   * function_call_arguments_delta in OpenAI), this field captures the incremental JSON string.
   *
   * Example sequence:
   * - Event 1: { partialJson: '{"title":' }
   * - Event 2: { partialJson: ' "Hello"' }
   * - Event 3: { partialJson: ',' }
   * - Event 4: { partialJson: ' "count": 1}' }
   *
   * Client should accumulate these chunks to reconstruct complete JSON argument objects.
   */
  partialJson?: string
}

/**
 * StreamingPipeline - Provider-specific streaming transformation strategy
 *
 * Handles stateful streaming transformations for a specific provider's wire format.
 * Unlike SchemaFormat (which is stateless), StreamingPipeline maintains state
 * to handle provider-specific streaming concerns like:
 * - Auto-emitting message_start on first content block (Anthropic)
 * - Filtering duplicate events from transformations
 * - Emitting final cleanup events (e.g., block_stop)
 */
export interface StreamingPipeline {
  /**
   * Parse raw SSE into unified StreamChunk format.
   *
   * @param chunk Raw SSE string (e.g., "data: {...}\n\n" or "data: {...}\n")
   * @returns Unified StreamChunk, array of chunks, or null if unparseable
   */
  parse(chunk: string): StreamChunk | StreamChunk[] | null

  /**
   * Build unified StreamChunk into target provider SSE format.
   *
   * @param chunk Unified StreamChunk to transform
   * @returns Provider-specific SSE string(s) or null if not buildable
   *
   * May return multiple strings (e.g., when injecting message_start).
   */
  build(chunk: StreamChunk | StreamChunk[]): string | string[] | null

  /**
   * Filter: Determine if output should be included in the stream.
   *
   * Use this to skip duplicate or redundant events.
   * Called AFTER build(), allowing format-specific filtering.
   *
   * @param output The SSE string to potentially filter
   * @returns true if output should be sent, false to skip
   */
  filter(output: string): boolean

  /**
   * Flush: Called when stream ends, to emit any final cleanup events.
   *
   * Used for stateful transformations that need to emit final events:
   * - Anthropic: Emit final block_stop event
   * - OpenAI: No special flush needed
   *
   * @returns Final SSE string(s) to emit, or null if nothing to send
   */
  flush(): string | null

  /**
   * Accumulate SSE stream into a complete JSON response.
   *
   * Used for endpoints that need to consume an SSE stream and return a single JSON object.
   * (e.g. converting streaming responses to non-streaming JSON for compatibility)
   *
   * @param reader - Readable stream reader for the raw response body
   * @returns Promise resolving to the accumulated JSON object (provider-specific format)
   */
  accumulateToJson?(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown>
}
