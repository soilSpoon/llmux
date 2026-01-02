/**
 * Anthropic Streaming Transformations
 *
 * Handles parsing and transforming Anthropic SSE stream events
 */

import type { StopReason, StreamChunk } from '../../types/unified'
import { createLogger } from '../../util/logger'
import type {
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockStopEvent,
  AnthropicErrorEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStartEvent,
  AnthropicStreamEvent,
} from './types'
import { isAnthropicStreamEvent } from './types'

const logger = createLogger({ service: 'anthropic-streaming' })

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
      return handleContentBlockStop(event as AnthropicContentBlockStopEvent)

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
      inputTokens: event.message?.usage?.input_tokens ?? 0,
      outputTokens: event.message?.usage?.output_tokens ?? 0,
    },
  }
}

function handleContentBlockStart(event: AnthropicContentBlockStartEvent): StreamChunk | null {
  const block = event.content_block
  const blockIndex = event.index

  switch (block.type) {
    case 'tool_use':
      return {
        type: 'tool_call',
        blockIndex,
        blockType: 'tool_call',
        delta: {
          toolCall: {
            id: block.id,
            name: block.name,
            arguments: block.input,
          },
        },
      }

    case 'text':
      return {
        type: 'content',
        blockIndex,
        blockType: 'text',
        delta: { type: 'text', text: '' },
      }

    case 'thinking':
      return {
        type: 'thinking',
        blockIndex,
        blockType: 'thinking',
        delta: { type: 'thinking', thinking: { text: '' } },
      }

    default:
      return null
  }
}

function handleContentBlockDelta(event: AnthropicContentBlockDeltaEvent): StreamChunk | null {
  const delta = event.delta
  const blockIndex = event.index

  switch (delta.type) {
    case 'text_delta':
      return {
        type: 'content',
        blockIndex,
        blockType: 'text',
        delta: {
          text: delta.text,
        },
      }

    case 'thinking_delta':
      return {
        type: 'thinking',
        blockIndex,
        blockType: 'thinking',
        delta: {
          thinking: {
            text: delta.thinking,
          },
        },
      }

    case 'signature_delta':
      return {
        type: 'thinking',
        blockIndex,
        blockType: 'thinking',
        delta: {
          thinking: {
            text: '',
            signature: delta.signature,
          },
        },
      }

    case 'input_json_delta':
      return {
        type: 'tool_call',
        blockIndex,
        blockType: 'tool_call',
        delta: {
          partialJson: delta.partial_json,
        },
      }

    default:
      return null
  }
}

function handleContentBlockStop(event: AnthropicContentBlockStopEvent): StreamChunk {
  return {
    type: 'block_stop',
    blockIndex: event.index,
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
  const blockIndex = chunk.blockIndex ?? 0

  switch (chunk.type) {
    case 'content':
      return formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'text_delta',
          text: chunk.delta?.text || '',
        },
      })

    case 'thinking': {
      const thinkingText = chunk.delta?.thinking?.text || ''
      const thinkingSignature = chunk.delta?.thinking?.signature

      if (thinkingSignature) {
        return formatSSE('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'signature_delta',
            signature: thinkingSignature,
          },
        })
      }

      if (!thinkingText) {
        return ''
      }

      return formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'thinking_delta',
          thinking: thinkingText,
        },
      })
    }

    case 'block_stop':
      return formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: blockIndex,
      })

    case 'tool_call': {
      // Check if we have partialJson in delta (streaming mode)
      const partialJson = chunk.delta?.partialJson
      const toolCall = chunk.delta?.toolCall

      // Handle partialJson streaming with toolCall metadata (e.g., from OpenAI → Anthropic conversion)
      // This case occurs when upstream provider sends tool ID/Name + incremental arguments
      // Example: OpenAI function_call_arguments_delta gets parsed as partialJson + toolCall
      if (partialJson && toolCall?.id) {
        logger.trace(
          {
            partialJsonPreview: partialJson.slice(0, 100),
            toolId: toolCall.id,
            toolName: toolCall.name,
          },
          '[ANTHROPIC] Received tool_call with partialJson + metadata'
        )

        if (partialJson.length === 0) return ''

        const events: string[] = []

        if (toolCall.id) {
          const startEvent = {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name || '',
              input: {},
            },
          }
          logger.trace(
            { startEvent },
            '[ANTHROPIC] tool_use content_block_start (from partialJson path)'
          )
          events.push(formatSSE('content_block_start', startEvent))
        }

        const CHUNK_SIZE = 50
        for (let i = 0; i < partialJson.length; i += CHUNK_SIZE) {
          const chunk = partialJson.slice(i, i + CHUNK_SIZE)
          events.push(
            formatSSE('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: chunk,
              },
            })
          )
        }

        logger.trace({ eventsCount: events.length }, '[ANTHROPIC] partialJson chunks with metadata')
        if (events.length === 1) return events[0] ?? ''
        return events
      }

      if (partialJson) {
        logger.trace(
          { partialJsonPreview: partialJson.slice(0, 100) },
          '[ANTHROPIC] Received tool_call with partialJson (no metadata)'
        )

        if (partialJson.length === 0) return ''

        const CHUNK_SIZE = 50
        const events: string[] = []

        for (let i = 0; i < partialJson.length; i += CHUNK_SIZE) {
          const chunk = partialJson.slice(i, i + CHUNK_SIZE)
          events.push(
            formatSSE('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: chunk,
              },
            })
          )
        }

        logger.trace({ eventsCount: events.length }, '[ANTHROPIC] partialJson chunks (no metadata)')
        if (events.length === 1) return events[0] ?? ''
        return events
      }

      logger.trace(
        { toolCallData: JSON.stringify(chunk).slice(0, 500) },
        '[ANTHROPIC] Received tool_call chunk'
      )
      if (!toolCall) return ''

      logger.trace(
        {
          toolId: toolCall.id,
          toolName: toolCall.name,
          hasArgs: !!toolCall.arguments,
        },
        '[ANTHROPIC] tool_call transform'
      )

      const events: string[] = []

      if (toolCall.id) {
        const startEvent = {
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: {},
          },
        }
        logger.trace({ startEvent }, '[ANTHROPIC] tool_use content_block_start')
        events.push(formatSSE('content_block_start', startEvent))
      }

      const args = toolCall.arguments
      if (args) {
        let jsonString: string
        if (typeof args === 'string') {
          jsonString = args
        } else if (typeof args === 'object') {
          jsonString = JSON.stringify(args)
        } else {
          jsonString = ''
        }

        logger.trace({ argsPreview: jsonString.slice(0, 100) }, '[ANTHROPIC] tool_call arguments')

        if (jsonString.length > 0) {
          const CHUNK_SIZE = 50
          for (let i = 0; i < jsonString.length; i += CHUNK_SIZE) {
            const chunk = jsonString.slice(i, i + CHUNK_SIZE)
            events.push(
              formatSSE('content_block_delta', {
                type: 'content_block_delta',
                index: blockIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: chunk,
                },
              })
            )
          }
        }
      }

      logger.trace({ eventsCount: events.length }, '[ANTHROPIC] tool_call events count')
      if (events.length === 0) return ''
      if (events.length === 1) return events[0] ?? ''
      return events
    }

    case 'usage': {
      const usage = {
        input_tokens: chunk.usage?.inputTokens ?? 0,
        output_tokens: chunk.usage?.outputTokens ?? 0,
        ...(chunk.usage?.cachedTokens && { cache_read_input_tokens: chunk.usage.cachedTokens }),
      }

      const hasStopReason = !!chunk.stopReason

      if (!hasStopReason) {
        // Initial usage (from message_start) → emit message_start only
        return formatSSE('message_start', {
          type: 'message_start',
          message: {
            id: `msg_${generateMessageId()}`,
            type: 'message',
            role: 'assistant',
            model: chunk.model ?? 'unknown',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage,
          },
        })
      }

      // Final usage (from message_delta with stop_reason) → emit message_delta only
      return formatSSE('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: chunk.stopReason,
          stop_sequence: null,
        },
        usage,
      })
    }

    case 'done': {
      const stopReason = chunk.stopReason || 'end_turn'
      const doneEvents: string[] = []

      if (stopReason === 'tool_use') {
        doneEvents.push(
          formatSSE('content_block_stop', {
            type: 'content_block_stop',
            index: blockIndex,
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
            input_tokens: chunk.usage?.inputTokens || 0,
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

function generateMessageId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}
