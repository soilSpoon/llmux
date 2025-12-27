/**
 * UnifiedRequest - Central hub format for all provider transformations
 */
export interface UnifiedRequest {
  messages: UnifiedMessage[]
  system?: string
  systemBlocks?: SystemBlock[] // Preserves cache_control for Anthropic
  tools?: UnifiedTool[]
  config?: GenerationConfig
  thinking?: ThinkingConfig
  metadata?: RequestMetadata
  stream?: boolean // Preserves stream parameter
}

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
 */
export interface ThinkingConfig {
  enabled: boolean
  budget?: number
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
 */
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'usage' | 'done' | 'error'
  delta?: Partial<ContentPart>
  usage?: UsageInfo
  stopReason?: StopReason
  error?: string
}
