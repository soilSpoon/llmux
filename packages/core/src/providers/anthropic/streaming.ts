/**
 * Anthropic Streaming Transformations
 *
 * Handles parsing and transforming Anthropic SSE stream events
 */

import type { StopReason, StreamChunk } from '../../types/unified'
import type {
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicErrorEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStartEvent,
  AnthropicStreamEvent,
} from './types'
import { isAnthropicStreamEvent } from './types'

/**
 * Parse an Anthropic SSE chunk into a unified StreamChunk
 */
export function parseStreamChunk(chunk: string): StreamChunk | null {
  const event = parseSSE(chunk)
  if (!event) return null

  return convertEventToChunk(event)
}

/**
 * Transform a unified StreamChunk into an Anthropic SSE string
 */
export function transformStreamChunk(chunk: StreamChunk): string | string[] {
  return convertChunkToSSE(chunk)
}

// =============================================================================
// SSE Parsing
// =============================================================================

function parseSSE(sseData: string): AnthropicStreamEvent | null {
  const trimmed = sseData.trim()
  if (!trimmed || trimmed === '') return null

  // Handle raw JSON (non-standard SSE from some providers like Opencode Zen)
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      if (isAnthropicStreamEvent(data)) {
        return data
      }
      return null
    } catch {
      return null
    }
  }

  // Parse SSE format: "event: <type>\ndata: <json>"
  const lines = trimmed.split('\n')
  let dataLine: string | null = null

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLine = line.slice(6)
    }
  }

  if (!dataLine) return null

  try {
    const data = JSON.parse(dataLine)
    if (isAnthropicStreamEvent(data)) {
      return data
    }
    return null
  } catch {
    return null
  }
}

function convertEventToChunk(event: AnthropicStreamEvent): StreamChunk | null {
  switch (event.type) {
    case 'message_start':
      return handleMessageStart(event as AnthropicMessageStartEvent)

    case 'content_block_start':
      return handleContentBlockStart(event as AnthropicContentBlockStartEvent)

    case 'content_block_delta':
      return handleContentBlockDelta(event as AnthropicContentBlockDeltaEvent)

    case 'content_block_stop':
      // No action needed for content_block_stop
      return null

    case 'message_delta':
      return handleMessageDelta(event as AnthropicMessageDeltaEvent)

    case 'message_stop':
      return handleMessageStop()

    case 'ping':
      // Ignore ping events
      return null

    case 'error':
      return handleError(event as AnthropicErrorEvent)

    default:
      return null
  }
}

function handleMessageStart(event: AnthropicMessageStartEvent): StreamChunk {
  return {
    type: 'usage',
    usage: {
      inputTokens: event.message.usage.input_tokens,
      outputTokens: event.message.usage.output_tokens,
    },
  }
}

function handleContentBlockStart(event: AnthropicContentBlockStartEvent): StreamChunk | null {
  const block = event.content_block

  switch (block.type) {
    case 'tool_use':
      return {
        type: 'tool_call',
        delta: {
          toolCall: {
            id: block.id,
            name: block.name,
            arguments: block.input,
          },
        },
      }

    case 'text':
    case 'thinking':
      // Text and thinking block starts don't produce chunks
      return null

    default:
      return null
  }
}

function handleContentBlockDelta(event: AnthropicContentBlockDeltaEvent): StreamChunk | null {
  const delta = event.delta

  switch (delta.type) {
    case 'text_delta':
      return {
        type: 'content',
        delta: {
          text: delta.text,
        },
      }

    case 'thinking_delta':
      return {
        type: 'thinking',
        delta: {
          thinking: {
            text: delta.thinking,
          },
        },
      }

    case 'signature_delta':
      return {
        type: 'thinking',
        delta: {
          thinking: {
            text: '',
            signature: delta.signature,
          },
        },
      }

    case 'input_json_delta':
      // Tool input is being streamed
      return {
        type: 'tool_call',
        delta: {
          text: delta.partial_json,
        },
      }

    default:
      return null
  }
}

function handleMessageDelta(event: AnthropicMessageDeltaEvent): StreamChunk {
  return {
    type: 'usage',
    usage: {
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
    },
    stopReason: parseStopReason(event.delta.stop_reason),
  }
}

function handleMessageStop(): StreamChunk {
  return {
    type: 'done',
  }
}

function handleError(event: AnthropicErrorEvent): StreamChunk {
  return {
    type: 'error',
    error: event.error.message,
  }
}

function parseStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'stop_sequence':
      return 'stop_sequence'
    default:
      return null
  }
}

// =============================================================================
// SSE Transformation
// =============================================================================

function convertChunkToSSE(chunk: StreamChunk): string | string[] {
  switch (chunk.type) {
    case 'content':
      return formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: chunk.delta?.text || '',
        },
      })

    case 'thinking': {
      // Thinking chunks contain reasoning text
      // Convert to thinking_delta for clients that support extended thinking
      const thinkingText = chunk.delta?.thinking?.text || ''
      const thinkingSignature = chunk.delta?.thinking?.signature

      // If we have a signature, output signature_delta
      if (thinkingSignature) {
        return formatSSE('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'signature_delta',
            signature: thinkingSignature,
          },
        })
      }

      // Skip empty thinking chunks
      if (!thinkingText) {
        return ''
      }

      return formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'thinking_delta',
          thinking: thinkingText,
        },
      })
    }

    case 'tool_call': {
      const toolCall = chunk.delta?.toolCall
      if (!toolCall) return ''

      const events: string[] = []

      // 1. Start event (if ID provided) - this signals a new tool call
      if (toolCall.id) {
        events.push(
          formatSSE('content_block_start', {
            type: 'content_block_start',
            index: 0, // Placeholder, updated by server/streaming.ts
            content_block: {
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: {}, // Input is built via deltas
            },
          })
        )
      }

      // 2. Delta event (if arguments provided) - this accumulates the JSON
      // arguments is typed as Record | string
      const args = toolCall.arguments
      if (args && typeof args === 'string' && args.length > 0) {
        events.push(
          formatSSE('content_block_delta', {
            type: 'content_block_delta',
            index: 0, // Placeholder
            delta: {
              type: 'input_json_delta',
              partial_json: args,
            },
          })
        )
      }

      if (events.length === 0) return ''
      if (events.length === 1) return events[0] ?? ''
      return events
    }

    case 'usage':
      // Usage is often sent with the done signal or separately.
      // We'll send a message_delta.
      return formatSSE('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: chunk.stopReason || null,
          stop_sequence: null,
        },
        usage: {
          output_tokens: chunk.usage?.outputTokens || 0,
        },
      })

    case 'done': {
      // When done, we MUST send message_delta with stop_reason if not sent yet, then message_stop.
      // If we finished with a tool call, we also need to close the content block.

      const stopReason = chunk.stopReason || 'end_turn'
      const doneEvents: string[] = []

      // If stop reason is tool_use, we imply the last content block (tool) is finished
      if (stopReason === 'tool_use') {
        doneEvents.push(
          formatSSE('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          })
        )
      }

      doneEvents.push(
        formatSSE('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: stopReason,
            stop_sequence: null,
          },
          usage: {
            output_tokens: chunk.usage?.outputTokens || 0,
          },
        })
      )

      doneEvents.push(
        formatSSE('message_stop', {
          type: 'message_stop',
        })
      )

      return doneEvents
    }

    case 'error':
      return formatSSE('error', {
        type: 'error',
        error: {
          type: 'server_error',
          message: chunk.error || 'Unknown error',
        },
      })

    default:
      return ''
  }
}

function formatSSE(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}
