/**
 * OpenAI Chat Completions API Types
 * Based on docs/reference/openai-chat-completions-schema.md
 */

// =============================================================================
// Request Types
// =============================================================================

/**
 * OpenAI Chat Completion Request
 */
export interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]

  // Generation parameters
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  stream?: boolean

  // Tool calling
  tools?: OpenAITool[]
  tool_choice?: OpenAIToolChoice
  parallel_tool_calls?: boolean

  // Advanced parameters
  frequency_penalty?: number
  presence_penalty?: number
  logit_bias?: Record<string, number>
  logprobs?: boolean
  top_logprobs?: number
  n?: number
  seed?: number
  response_format?: { type: 'text' | 'json_object' }
  service_tier?: string
  user?: string

  // Streaming options
  stream_options?: { include_usage: boolean }

  // Reasoning (o1/o3 models)
  reasoning_effort?: 'low' | 'medium' | 'high'
}

/**
 * OpenAI Message - Union of all message types
 */
export type OpenAIMessage =
  | OpenAISystemMessage
  | OpenAIUserMessage
  | OpenAIAssistantMessage
  | OpenAIToolMessage

/**
 * System message
 */
export interface OpenAISystemMessage {
  role: 'system'
  content: string | OpenAIContentPart[]
  name?: string
}

/**
 * User message
 */
export interface OpenAIUserMessage {
  role: 'user'
  content: string | OpenAIContentPart[]
}

/**
 * Assistant message
 */
export interface OpenAIAssistantMessage {
  role: 'assistant'
  content?: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  reasoning_content?: string
}

/**
 * Tool result message
 */
export interface OpenAIToolMessage {
  role: 'tool'
  content: string | OpenAIContentPart[]
  tool_call_id: string
}

/**
 * Content part types
 */
export type OpenAIContentPart = OpenAITextContent | OpenAIImageContent

export interface OpenAITextContent {
  type: 'text'
  text: string
}

export interface OpenAIImageContent {
  type: 'image_url'
  image_url:
    | string
    | {
        url: string
        detail?: 'auto' | 'low' | 'high'
      }
}

/**
 * Tool definition
 */
export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: OpenAIFunctionParameters
    strict?: boolean
  }
}

/**
 * Function parameters (JSON Schema)
 */
export interface OpenAIFunctionParameters {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * Tool call in assistant message
 */
export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/**
 * Tool choice
 */
export type OpenAIToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }

// =============================================================================
// Response Types
// =============================================================================

/**
 * OpenAI Chat Completion Response
 */
export interface OpenAIResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChoice[]
  usage?: OpenAIUsage
  system_fingerprint?: string
}

/**
 * Response choice
 */
export interface OpenAIChoice {
  index: number
  message: OpenAIResponseMessage
  finish_reason: OpenAIFinishReason
  logprobs?: unknown | null
}

/**
 * Response message
 */
export interface OpenAIResponseMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  refusal?: string | null
  reasoning_content?: string
}

/**
 * Finish reason
 */
export type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | null

/**
 * Usage information
 */
export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: {
    cached_tokens?: number
    audio_tokens?: number
    text_tokens?: number
    image_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
  }
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * OpenAI Streaming Chunk
 */
export interface OpenAIStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: OpenAIChunkChoice[]
  usage?: OpenAIUsage
}

/**
 * Streaming chunk choice
 */
export interface OpenAIChunkChoice {
  index: number
  delta: OpenAIDelta
  finish_reason: OpenAIFinishReason
  logprobs?: unknown | null
}

/**
 * Delta content in streaming
 */
export interface OpenAIDelta {
  role?: 'assistant'
  content?: string
  tool_calls?: OpenAIDeltaToolCall[]
  reasoning_content?: string
}

/**
 * Delta tool call in streaming
 */
export interface OpenAIDeltaToolCall {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is an OpenAI request
 */
export function isOpenAIRequest(value: unknown): value is OpenAIRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.model === 'string' && Array.isArray(obj.messages)
}

/**
 * Check if value is an OpenAI response
 */
export function isOpenAIResponse(value: unknown): value is OpenAIResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' && obj.object === 'chat.completion' && Array.isArray(obj.choices)
  )
}

/**
 * Check if value is an OpenAI message
 */
export function isOpenAIMessage(value: unknown): value is OpenAIMessage {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  const validRoles = ['system', 'user', 'assistant', 'tool']
  return typeof obj.role === 'string' && validRoles.includes(obj.role)
}

/**
 * Check if value is an OpenAI stream chunk
 */
export function isOpenAIStreamChunk(value: unknown): value is OpenAIStreamChunk {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    obj.object === 'chat.completion.chunk' &&
    Array.isArray(obj.choices)
  )
}
