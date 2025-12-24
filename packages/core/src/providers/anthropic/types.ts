/**
 * Anthropic Claude API Types
 * Based on docs/reference/anthropic-api-schema.md
 */

// =============================================================================
// Request Types
// =============================================================================

/**
 * Anthropic Messages Request
 */
export interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  max_tokens: number

  // System prompt (string or array of blocks)
  system?: string | AnthropicSystemBlock[]

  // Generation parameters
  stream?: boolean
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  metadata?: { user_id?: string }

  // Tools
  tools?: AnthropicTool[]
  tool_choice?: AnthropicToolChoice

  // Extended Thinking
  thinking?: {
    type: 'enabled'
    budget_tokens: number
  }
}

/**
 * Anthropic Message
 */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/**
 * System block
 */
export interface AnthropicSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Content block types
 */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock
  | AnthropicRedactedThinkingBlock
  | AnthropicDocumentBlock

/**
 * Text block
 */
export interface AnthropicTextBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Image block
 */
export interface AnthropicImageBlock {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
    | { type: 'file'; file_id: string }
  cache_control?: { type: 'ephemeral' }
}

/**
 * Document block (PDFs)
 */
export interface AnthropicDocumentBlock {
  type: 'document'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
    | { type: 'file'; file_id: string }
  title?: string
  context?: string
  citations?: { enabled: boolean }
  cache_control?: { type: 'ephemeral' }
}

/**
 * Tool use block (in assistant messages)
 */
export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  cache_control?: { type: 'ephemeral' }
}

/**
 * Tool result block (in user messages)
 */
export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | AnthropicToolResultContent[]
  is_error?: boolean
  cache_control?: { type: 'ephemeral' }
}

/**
 * Tool result content
 */
export type AnthropicToolResultContent = AnthropicTextBlock | AnthropicImageBlock

/**
 * Thinking block (extended thinking)
 */
export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Redacted thinking block
 */
export interface AnthropicRedactedThinkingBlock {
  type: 'redacted_thinking'
  data: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Tool definition
 */
export interface AnthropicTool {
  type?: 'custom'
  name: string
  description?: string
  input_schema: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
    $defs?: Record<string, unknown>
    strict?: boolean
  }
  cache_control?: { type: 'ephemeral' }
}

/**
 * Tool choice
 */
export interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'tool' | 'none'
  name?: string
  disable_parallel_tool_use?: boolean
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Anthropic Messages Response
 */
export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: AnthropicStopReason
  stop_sequence: string | null
  usage: AnthropicUsage
}

/**
 * Stop reason
 */
export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null

/**
 * Usage information
 */
export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Anthropic Stream Event - Union of all event types
 */
export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicErrorEvent

/**
 * message_start event
 */
export interface AnthropicMessageStartEvent {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    model: string
    content: AnthropicContentBlock[]
    stop_reason: AnthropicStopReason
    stop_sequence: string | null
    usage: AnthropicUsage
  }
}

/**
 * content_block_start event
 */
export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start'
  index: number
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'thinking'; thinking: string }
}

/**
 * content_block_delta event
 */
export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
}

/**
 * content_block_stop event
 */
export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop'
  index: number
}

/**
 * message_delta event
 */
export interface AnthropicMessageDeltaEvent {
  type: 'message_delta'
  delta: {
    stop_reason: AnthropicStopReason
    stop_sequence?: string | null
  }
  usage: {
    output_tokens: number
  }
}

/**
 * message_stop event
 */
export interface AnthropicMessageStopEvent {
  type: 'message_stop'
}

/**
 * ping event
 */
export interface AnthropicPingEvent {
  type: 'ping'
}

/**
 * error event
 */
export interface AnthropicErrorEvent {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is an Anthropic request
 */
export function isAnthropicRequest(value: unknown): value is AnthropicRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.model === 'string' &&
    Array.isArray(obj.messages) &&
    typeof obj.max_tokens === 'number'
  )
}

/**
 * Check if value is an Anthropic response
 */
export function isAnthropicResponse(value: unknown): value is AnthropicResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    obj.type === 'message' &&
    obj.role === 'assistant' &&
    Array.isArray(obj.content)
  )
}

/**
 * Check if value is an Anthropic message
 */
export function isAnthropicMessage(value: unknown): value is AnthropicMessage {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  // Anthropic only uses 'user' and 'assistant' roles (system is separate)
  return typeof obj.role === 'string' && (obj.role === 'user' || obj.role === 'assistant')
}

/**
 * Check if value is an Anthropic stream event
 */
export function isAnthropicStreamEvent(value: unknown): value is AnthropicStreamEvent {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  const validTypes = [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
    'ping',
    'error',
  ]
  return typeof obj.type === 'string' && validTypes.includes(obj.type)
}
