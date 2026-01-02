/**
 * Transform OpenAI Responses API request to Chat Completions API request
 */
import type {
  ResponsesContentPart,
  ResponsesInputMessage,
  ResponsesOutputItem,
  ResponsesRequest,
  ResponsesResponse,
} from './types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionsRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
}

export interface ChatCompletionsResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    message: {
      role: string
      content: string | null
    }
    finish_reason: string
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Extract text content from a message content (string or content parts array)
 */
function extractTextContent(content: string | ResponsesContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter(
      (part): part is ResponsesContentPart & { text: string } =>
        part.type === 'input_text' && !!part.text
    )
    .map((part) => part.text)
    .join('')
}

/**
 * Convert Responses API role to Chat Completions role
 */
function convertRole(role: ResponsesInputMessage['role']): ChatMessage['role'] {
  if (role === 'developer') {
    return 'system'
  }
  return role
}

/**
 * Transform a single input message to chat message
 */
function transformInputMessage(message: ResponsesInputMessage): ChatMessage {
  return {
    role: convertRole(message.role),
    content: extractTextContent(message.content),
  }
}

/**
 * Transform Responses API request to Chat Completions API request
 */
export function transformResponsesRequest(request: ResponsesRequest): ChatCompletionsRequest {
  const messages: ChatMessage[] = []

  if (request.instructions) {
    messages.push({ role: 'system', content: request.instructions })
  }

  if (typeof request.input === 'string') {
    messages.push({ role: 'user', content: request.input })
  } else {
    messages.push(...request.input.map(transformInputMessage))
  }

  const result: ChatCompletionsRequest = {
    model: request.model,
    messages,
  }

  if (request.stream !== undefined) {
    result.stream = request.stream
  }

  if (request.temperature !== undefined) {
    result.temperature = request.temperature
  }

  if (request.max_output_tokens !== undefined) {
    result.max_tokens = request.max_output_tokens
  }

  if (request.top_p !== undefined) {
    result.top_p = request.top_p
  }

  return result
}

/**
 * Generate a unique response ID with resp_ prefix
 */
function generateResponseId(): string {
  return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Generate a unique message ID with msg_ prefix
 */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Map finish_reason to Responses API status
 */
function mapFinishReasonToStatus(finishReason: string): ResponsesResponse['status'] {
  switch (finishReason) {
    case 'stop':
      return 'completed'
    case 'length':
      return 'incomplete'
    case 'content_filter':
      return 'incomplete'
    default:
      return 'completed'
  }
}

/**
 * Transform Chat Completions API response to Responses API response
 */
export function transformToResponsesResponse(res: ChatCompletionsResponse): ResponsesResponse {
  const output: ResponsesOutputItem[] = res.choices.map((choice) => ({
    type: 'message' as const,
    id: generateMessageId(),
    role: 'assistant' as const,
    content: [
      {
        type: 'output_text' as const,
        text: choice.message.content ?? '',
        annotations: [],
      },
    ],
    status: (choice.finish_reason === 'stop' ? 'completed' : 'in_progress') as
      | 'completed'
      | 'in_progress',
  }))

  const finishReason = res.choices[0]?.finish_reason ?? 'stop'
  const status = mapFinishReasonToStatus(finishReason)

  const response: ResponsesResponse = {
    id: generateResponseId(),
    object: 'response',
    created_at: res.created,
    status,
    output,
    model: res.model,
  }

  if (res.usage) {
    response.usage = {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      total_tokens: res.usage?.total_tokens ?? 0,
    }
  }

  if (status === 'incomplete' && finishReason === 'length') {
    response.incomplete_details = { reason: 'max_output_tokens' }
  } else if (status === 'incomplete' && finishReason === 'content_filter') {
    response.incomplete_details = { reason: 'content_filter' }
  }

  return response
}
