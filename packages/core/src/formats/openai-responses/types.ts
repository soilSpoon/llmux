/**
 * OpenAI Responses API Types
 *
 * Types for the /v1/responses endpoint (Codex/Responses API).
 * Similar to Chat Completions but with specific fields for input/output text and thinking.
 */

// import type { OpenAIChatFunctionParameters as OpenAIFunctionParameters } from '../openai-chat/types'

// Re-use standard OpenAI types where compatible
export interface OpenAIResponsesRequest {
  model: string
  messages?: OpenAIResponsesMessage[]
  input?: OpenAIResponsesInputItem[] // Alias for messages in some contexts, but can contain function_call items
  max_tokens?: number
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[]
  presence_penalty?: number
  frequency_penalty?: number
  logit_bias?: Record<string, number>
  user?: string

  // Responses API specific
  instructions?: string
  input_text?: string
}

export type OpenAIResponsesMessage =
  | OpenAIResponsesUserMessage
  | OpenAIResponsesAssistantMessage
  | OpenAIResponsesSystemMessage
  | OpenAIResponsesToolMessage

export interface OpenAIResponsesUserMessage {
  role: 'user'
  content: string | OpenAIResponsesContentPart[]
  name?: string
}

export interface OpenAIResponsesAssistantMessage {
  role: 'assistant'
  content?: string | null
  name?: string
  tool_calls?: OpenAIResponsesToolCall[]
  // Responses API reasoning
  reasoning_content?: string
}

export interface OpenAIResponsesSystemMessage {
  role: 'system' | 'developer'
  content: string
  name?: string
}

export interface OpenAIResponsesToolMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

export type OpenAIResponsesContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_text'; text: string } // Specific to Responses API
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface OpenAIResponsesToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAIResponsesFunctionCall {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export interface OpenAIResponsesFunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

export interface OpenAIResponsesAssistantWithContent {
  role: 'assistant'
  content: Array<{ type: 'output_text'; text: string }>
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesMessage
  | OpenAIResponsesFunctionCall
  | OpenAIResponsesFunctionCallOutput
  | OpenAIResponsesAssistantWithContent

// Responses API Streaming Types

export interface ResponsesOutputItem {
  id?: string
  type: 'message' | 'reasoning' | 'function_call'
  role?: string
  status?: string
  content?: Array<{
    type: string
    text?: string
    annotations?: unknown[]
  }>
  summary?: Array<{
    type: string
    text?: string
  }>
  name?: string
  call_id?: string
  arguments?: string
}

export interface ResponsesResponse {
  id?: string
  object?: string
  model?: string
  status?: 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'incomplete'
  created_at?: number
  completed_at?: number | null
  output?: ResponsesOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: {
      cached_tokens?: number
    }
    output_tokens_details?: {
      reasoning_tokens?: number
    }
  }

  background?: boolean
  instructions?: string
  obfuscation?: boolean | { type: string; reason?: string }
  tools?: Array<{
    type: string
    name?: string
    description?: string
    parameters?: Record<string, unknown>
    function?: {
      name: string
      description?: string
      parameters?: Record<string, unknown>
    }
  }>
  tool_choice?: string | { type: string; name?: string; function?: { name: string } }

  reasoning?: {
    enabled?: boolean
    effort?: 'none' | 'low' | 'medium' | 'high'
    summary?: 'auto' | 'concise' | 'detailed' | 'none'
  }

  text?: {
    format?: {
      type?: string
    }
    verbosity?: string
  }

  truncation?: 'auto' | 'disabled'
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  min_output_tokens?: number
  parallel_tool_calls?: boolean
  store?: boolean
  prompt_cache_key?: string
  top_logprobs?: number
  service_tier?: string
  safety_identifier?: string
  max_tool_calls?: number | null
  previous_response_id?: string | null
  prompt_cache_retention?: number | null

  error?: {
    message?: string
    code?: string
    type?: string
  } | null
  incomplete_details?: {
    reason?: string
  } | null

  metadata?: Record<string, unknown>
  user?: string
}

export interface ResponsesStreamEvent {
  type: string
  sequence_number?: number
  response?: ResponsesResponse
  output_index?: number
  item_id?: string
  item?: ResponsesOutputItem
  delta?: string
  text?: string
  content_index?: number
  summary_index?: number
  obfuscation?: boolean | { type: string; reason?: string }
  logprobs?: unknown[]
  part?: unknown
  name?: string
  call_id?: string
  arguments?: string
}
