/**
 * OpenAI Responses API Types
 * @see https://platform.openai.com/docs/api-reference/responses
 */

// ============================================================================
// Request Types
// ============================================================================

/**
 * ResponsesRequest - OpenAI Responses API request format
 */
export interface ResponsesRequest {
  model: string
  input: string | ResponsesInputMessage[]
  instructions?: string
  stream?: boolean
  temperature?: number
  max_output_tokens?: number
  top_p?: number
  store?: boolean
  metadata?: Record<string, string>
  tool_choice?: 'auto' | 'none' | 'required' | ResponsesToolChoice
  tools?: ResponsesToolDefinition[]
  parallel_tool_calls?: boolean
  previous_response_id?: string
  reasoning?: ResponsesReasoningConfig
  truncation?: 'auto' | 'disabled'
}

/**
 * ResponsesInputMessage - Message in the input array
 */
export interface ResponsesInputMessage {
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string | ResponsesContentPart[]
}

/**
 * ResponsesContentPart - Content part in a message
 */
export interface ResponsesContentPart {
  type: 'input_text' | 'input_image' | 'input_audio' | 'input_file'
  text?: string
  image_url?: string
  image_file?: { file_id: string }
  audio?: { data: string; format: 'wav' | 'mp3' }
  file?: { file_id: string }
}

/**
 * ResponsesToolChoice - Specific tool choice
 */
export interface ResponsesToolChoice {
  type: 'function'
  function: { name: string }
}

/**
 * ResponsesToolDefinition - Tool definition for function calling
 */
export interface ResponsesToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
}

/**
 * ResponsesReasoningConfig - Reasoning/thinking configuration
 */
export interface ResponsesReasoningConfig {
  effort?: 'low' | 'medium' | 'high'
  summary?: 'auto' | 'concise' | 'detailed'
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * ResponsesResponse - OpenAI Responses API response format
 */
export interface ResponsesResponse {
  id: string
  object: 'response'
  created_at: number
  status: 'completed' | 'failed' | 'in_progress' | 'incomplete'
  output: ResponsesOutputItem[]
  usage?: ResponsesUsage
  model?: string
  error?: ResponsesError
  incomplete_details?: {
    reason: 'max_output_tokens' | 'content_filter'
  }
}

/**
 * ResponsesOutputItem - Output item in the response
 */
export interface ResponsesOutputItem {
  type: 'message'
  id: string
  role: 'assistant'
  content: ResponsesOutputContent[]
  status: 'completed' | 'in_progress'
}

/**
 * ResponsesOutputContent - Content in an output item
 */
export interface ResponsesOutputContent {
  type: 'output_text'
  text: string
  annotations?: ResponsesAnnotation[]
}

/**
 * ResponsesAnnotation - Annotation on output content
 */
export interface ResponsesAnnotation {
  type: 'file_citation' | 'url_citation'
  file_id?: string
  url?: string
  title?: string
  start_index?: number
  end_index?: number
}

/**
 * ResponsesUsage - Token usage information
 */
export interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: {
    cached_tokens?: number
  }
  output_tokens_details?: {
    reasoning_tokens?: number
  }
}

/**
 * ResponsesError - Error information
 */
export interface ResponsesError {
  code: string
  message: string
}

// ============================================================================
// Streaming Event Types
// ============================================================================

/**
 * ResponsesStreamEvent - Union type for all streaming events
 */
export type ResponsesStreamEvent =
  | ResponsesCreatedEvent
  | ResponsesInProgressEvent
  | ResponsesOutputItemAddedEvent
  | ResponsesContentPartAddedEvent
  | ResponsesOutputTextDeltaEvent
  | ResponsesOutputTextDoneEvent
  | ResponsesOutputItemDoneEvent
  | ResponsesCompletedEvent
  | ResponsesFailedEvent
  | ResponsesErrorEvent

export interface ResponsesCreatedEvent {
  type: 'response.created'
  response: ResponsesResponse
}

export interface ResponsesInProgressEvent {
  type: 'response.in_progress'
  response: ResponsesResponse
}

export interface ResponsesOutputItemAddedEvent {
  type: 'response.output_item.added'
  output_index: number
  item: ResponsesOutputItem
}

export interface ResponsesContentPartAddedEvent {
  type: 'response.content_part.added'
  output_index: number
  content_index: number
  part: ResponsesOutputContent
}

export interface ResponsesOutputTextDeltaEvent {
  type: 'response.output_text.delta'
  output_index: number
  content_index: number
  delta: string
}

export interface ResponsesOutputTextDoneEvent {
  type: 'response.output_text.done'
  output_index: number
  content_index: number
  text: string
}

export interface ResponsesOutputItemDoneEvent {
  type: 'response.output_item.done'
  output_index: number
  item: ResponsesOutputItem
}

export interface ResponsesCompletedEvent {
  type: 'response.completed'
  response: ResponsesResponse
}

export interface ResponsesFailedEvent {
  type: 'response.failed'
  response: ResponsesResponse
}

export interface ResponsesErrorEvent {
  type: 'error'
  error: {
    message: string
    code?: string
  }
}
