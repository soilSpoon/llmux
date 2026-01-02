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
}

/**
 * ThinkingConfig - Extended thinking/reasoning configuration
 * Unified configuration for thinking/reasoning across different providers
 */
export interface ThinkingConfig {
  enabled: boolean
  budget?: number
  effort?: 'none' | 'low' | 'medium' | 'high'
  level?: 'low' | 'medium' | 'high' // Gemini 3 specific
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
  userId?: string
  sessionId?: string
  conversationId?: string
  [key: string]: unknown
}

/**
 * UsageInfo - Token usage information
 */
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  thinkingTokens?: number
  cachedTokens?: number
  /** Amp-specific: Logical credit consumption */
  credits?: number
}

/**
 * StopReason - Reason for generation completion
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
 * UnifiedTool - Tool/function definition
 */
export interface UnifiedTool {
  name: string
  description?: string
  parameters: JSONSchema
}

/**
 * JSONSchema - Simplified JSON Schema for tool parameters
 */
export interface JSONSchema {
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
 * StreamChunk - Represents a single streaming chunk
 *
 * Multi-block streaming support:
 * - blockIndex: 0-based index identifying which content block this chunk belongs to
 * - blockType: The type of content block (text, tool_call, thinking, etc.)
 * - type: 'block_stop' signals the end of a specific content block
 */
export interface StreamChunk {
  type:
    | 'content'
    | 'tool_call'
    | 'tool_result'
    | 'thinking'
    | 'usage'
    | 'block_stop'
    | 'done'
    | 'error'

  /** 0-based block index for multi-block streaming (defaults to 0 for single-block providers) */
  blockIndex?: number

  /** Type of the content block this chunk belongs to */
  blockType?: ContentPart['type']

  delta?: StreamDelta
  usage?: UsageInfo
  stopReason?: StopReason
  error?: string
  model?: string
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
