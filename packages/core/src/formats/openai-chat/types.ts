/**
 * OpenAI Chat Completions Format Types
 *
 * Wire format types for OpenAI Chat Completions API.
 * These types define the external API schema, separate from UnifiedRequest/Response.
 */

// =============================================================================
// Request Types
// =============================================================================

/**
 * OpenAI Chat Completion Request
 */
export interface OpenAIChatRequest {
  model: string
  messages?: OpenAIChatMessage[]
  input?: OpenAIChatMessage[]

  // Generation parameters
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  stream?: boolean

  // Tool calling
  tools?: OpenAIChatTool[]
  tool_choice?: OpenAIChatToolChoice
  parallel_tool_calls?: boolean

  // Advanced parameters
  frequency_penalty?: number
  presence_penalty?: number
  logit_bias?: Record<string, number>
  logprobs?: boolean
  top_logprobs?: number
  n?: number
  seed?: number
  response_format?:
    | { type: 'text' | 'json_object' }
    | {
        type: 'json_schema'
        json_schema: {
          name: string
          strict?: boolean
          schema?: Record<string, unknown>
          description?: string
        }
      }
  service_tier?: string
  user?: string

  // Streaming options
  stream_options?: { include_usage: boolean }

  // Reasoning (o1/o3 models)
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high'
  max_completion_tokens?: number

  // Thinking (GLM models)
  thinking?: OpenAIChatThinkingConfig
}

/**
 * GLM thinking configuration
 */
export interface OpenAIChatThinkingConfig {
  type?: 'enabled' | 'disabled'
  clear_thinking?: boolean
}

/**
 * OpenAI Message - Union of all message types
 */
export type OpenAIChatMessage =
  | OpenAIChatSystemMessage
  | OpenAIChatDeveloperMessage
  | OpenAIChatUserMessage
  | OpenAIChatAssistantMessage
  | OpenAIChatToolMessage

/**
 * System message
 */
export interface OpenAIChatSystemMessage {
  role: 'system'
  content: string | OpenAIChatContentPart[]
  name?: string
}

/**
 * Developer message (o1/reasoning models)
 */
export interface OpenAIChatDeveloperMessage {
  role: 'developer'
  content: string | OpenAIChatContentPart[]
  name?: string
}

/**
 * User message
 */
export interface OpenAIChatUserMessage {
  role: 'user'
  content: string | OpenAIChatContentPart[]
}

/**
 * Assistant message
 */
export interface OpenAIChatAssistantMessage {
  role: 'assistant'
  content?: string | OpenAIChatContentPart[] | null
  name?: string
  tool_calls?: OpenAIChatToolCall[]
  reasoning_content?: string
}

/**
 * Tool result message
 */
export interface OpenAIChatToolMessage {
  role: 'tool'
  content: string | OpenAIChatContentPart[]
  tool_call_id: string
}

/**
 * Content part types
 */
export type OpenAIChatContentPart =
  | OpenAIChatTextContent
  | OpenAIChatInputTextContent
  | OpenAIChatImageContent

export interface OpenAIChatTextContent {
  type: 'text'
  text: string
}

export interface OpenAIChatInputTextContent {
  type: 'input_text'
  text: string
}

export interface OpenAIChatImageContent {
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
export interface OpenAIChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: OpenAIChatFunctionParameters
    strict?: boolean
  }
}

/**
 * Function parameters (JSON Schema)
 */
export interface OpenAIChatFunctionParameters {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * Tool call in assistant message
 */
export interface OpenAIChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/**
 * Flattened tool call format (from Responses API)
 * When tool calls are flattened into the message array
 */
export interface OpenAIChatFlattenedToolCall {
  type: 'function'
  name: string
  call_id: string
  arguments: string // JSON string
}

/**
 * Tool choice
 */
export type OpenAIChatToolChoice =
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
export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChatChoice[]
  usage?: OpenAIChatUsage
  system_fingerprint?: string
}

/**
 * Response choice
 */
export interface OpenAIChatChoice {
  index: number
  message: OpenAIChatResponseMessage
  finish_reason: OpenAIChatFinishReason
  logprobs?: unknown | null
}

/**
 * Response message
 */
export interface OpenAIChatResponseMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: OpenAIChatToolCall[]
  refusal?: string | null
  reasoning_content?: string
}

/**
 * Finish reason
 */
export type OpenAIChatFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | null

/**
 * Usage information
 */
export interface OpenAIChatUsage {
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
// Type Guards
// =============================================================================

/**
 * Check if value is an OpenAI Chat request
 */
export function isOpenAIChatRequest(value: unknown): value is OpenAIChatRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.model === 'string' && (Array.isArray(obj.messages) || Array.isArray(obj.input))
}

/**
 * Check if value is an OpenAI Chat message
 */
export function isOpenAIChatMessage(value: unknown): value is OpenAIChatMessage {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  const validRoles = ['system', 'developer', 'user', 'assistant', 'tool']
  return typeof obj.role === 'string' && validRoles.includes(obj.role)
}

/**
 * Check if value is an OpenAI Chat response
 */
export function isOpenAIChatResponse(value: unknown): value is OpenAIChatResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return obj.object === 'chat.completion' && Array.isArray(obj.choices)
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * OpenAI Streaming Chunk
 */
export interface OpenAIChatStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: OpenAIChatChunkChoice[]
  usage?: OpenAIChatUsage
}

/**
 * Streaming chunk choice
 */
export interface OpenAIChatChunkChoice {
  index: number
  delta: OpenAIChatDelta
  finish_reason: OpenAIChatFinishReason
  logprobs?: unknown | null
}

/**
 * Delta content in streaming
 */
export interface OpenAIChatDelta {
  role?: 'assistant'
  content?: string
  tool_calls?: OpenAIChatDeltaToolCall[]
  reasoning_content?: string
}

/**
 * Delta tool call in streaming
 */
export interface OpenAIChatDeltaToolCall {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

/**
 * Check if value is an OpenAI stream chunk
 */
export function isOpenAIChatStreamChunk(value: unknown): value is OpenAIChatStreamChunk {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    obj.object === 'chat.completion.chunk' &&
    Array.isArray(obj.choices)
  )
}
