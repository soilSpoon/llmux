/**
 * Streaming transformation from Chat Completions API to Responses API
 */
import type {
  ResponsesOutputContent,
  ResponsesOutputItem,
  ResponsesResponse,
  ResponsesStreamEvent,
} from './types'

/**
 * Chat Completions API streaming chunk format
 */
export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: string
      content?: string
    }
    finish_reason: string | null
  }[]
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
 * Transforms Chat Completions streaming chunks to Responses API streaming events
 */
export class ResponsesStreamTransformer {
  private responseId: string
  private outputItemId: string
  private accumulatedText: string
  private isFirstChunk: boolean
  private model: string
  private createdAt: number

  constructor(model: string) {
    this.responseId = generateResponseId()
    this.outputItemId = generateMessageId()
    this.accumulatedText = ''
    this.isFirstChunk = true
    this.model = model
    this.createdAt = Math.floor(Date.now() / 1000)
  }

  /**
   * Creates the base response object
   */
  private createBaseResponse(status: ResponsesResponse['status']): ResponsesResponse {
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.createdAt,
      status,
      output: [],
      model: this.model,
    }
  }

  /**
   * Creates the output item
   */
  private createOutputItem(status: 'in_progress' | 'completed'): ResponsesOutputItem {
    return {
      type: 'message',
      id: this.outputItemId,
      role: 'assistant',
      content:
        status === 'completed'
          ? [
              {
                type: 'output_text',
                text: this.accumulatedText,
              },
            ]
          : [],
      status,
    }
  }

  /**
   * Creates the content part
   */
  private createContentPart(): ResponsesOutputContent {
    return {
      type: 'output_text',
      text: '',
    }
  }

  /**
   * Transform a single chunk to multiple events
   */
  transformChunk(chunk: ChatCompletionChunk): ResponsesStreamEvent[] {
    const events: ResponsesStreamEvent[] = []
    const choice = chunk.choices[0]

    if (!choice) {
      return events
    }

    const delta = choice.delta
    const finishReason = choice.finish_reason

    if (this.isFirstChunk) {
      this.isFirstChunk = false
      this.createdAt = chunk.created

      events.push({
        type: 'response.created',
        response: this.createBaseResponse('in_progress'),
      })

      events.push({
        type: 'response.output_item.added',
        output_index: 0,
        item: this.createOutputItem('in_progress'),
      })

      events.push({
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 0,
        part: this.createContentPart(),
      })
    }

    if (delta.content && delta.content.length > 0) {
      this.accumulatedText += delta.content

      events.push({
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: delta.content,
      })
    }

    if (finishReason !== null) {
      const status = finishReason === 'stop' ? 'completed' : 'incomplete'

      events.push({
        type: 'response.output_text.done',
        output_index: 0,
        content_index: 0,
        text: this.accumulatedText,
      })

      events.push({
        type: 'response.output_item.done',
        output_index: 0,
        item: this.createOutputItem('completed'),
      })

      const response = this.createBaseResponse(status)
      response.output = [this.createOutputItem('completed')]

      events.push({
        type: 'response.completed',
        response,
      })
    }

    return events
  }

  /**
   * Finish the stream and emit any final events
   * Called when receiving [DONE] signal
   */
  finish(): ResponsesStreamEvent[] {
    return []
  }
}

/**
 * Parse a single SSE line into a ChatCompletionChunk
 * @returns ChatCompletionChunk if valid data, 'DONE' if [DONE] signal, null otherwise
 */
export function parseSSELine(line: string): ChatCompletionChunk | null | 'DONE' {
  if (!line || line.startsWith('event:') || line.startsWith(':')) {
    return null
  }

  if (!line.startsWith('data:')) {
    return null
  }

  const data = line.slice(5).trim()

  if (data === '[DONE]') {
    return 'DONE'
  }

  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch {
    return null
  }
}
