/**
 * OpenAI Responses API Streaming Transformations
 *
 * Parses SSE events from the OpenAI Responses API format
 * which is different from the standard Chat Completions API.
 *
 * Responses API events:
 * - response.created
 * - response.in_progress
 * - response.output_item.added
 * - response.output_text.delta
 * - response.output_text.done
 * - response.output_item.done
 * - response.function_call_arguments.delta
 * - response.function_call_arguments.done
 * - response.completed
 * - response.failed
 */

import type { ResponseMetadata, StreamChunk } from '../../types/unified'
import { createLogger } from '../../util/logger'
import { parseStreamChunk as parseOpenAIChatStreamChunk } from '../openai-chat/streaming'
import type { ResponsesResponse, ResponsesStreamEvent } from './types'

const logger = createLogger({ service: 'openai-responses-streaming' })

/**
 * Extract ResponseMetadata from a ResponsesResponse object.
 * This enables lossless round-trip transformation for response.created/in_progress events.
 */
function extractResponseMetadata(
  response: ResponsesResponse,
  obfuscation?: boolean
): ResponseMetadata {
  return {
    responseId: response.id,
    object: response.object,
    model: response.model,
    status: response.status,
    createdAt: response.created_at,
    completedAt: response.completed_at,
    background: response.background,
    instructions: response.instructions,
    tools: response.tools,
    toolChoice: response.tool_choice,
    reasoning: response.reasoning,
    text: response.text,
    truncation: response.truncation,
    temperature: response.temperature,
    topP: response.top_p,
    maxOutputTokens: response.max_output_tokens,
    parallelToolCalls: response.parallel_tool_calls,
    store: response.store,
    promptCacheKey: response.prompt_cache_key,
    topLogprobs: response.top_logprobs,
    serviceTier: response.service_tier,
    safetyIdentifier: response.safety_identifier,
    maxToolCalls: response.max_tool_calls,
    previousResponseId: response.previous_response_id,
    promptCacheRetention: response.prompt_cache_retention,
    obfuscation,
    error: response.error,
    incompleteDetails: response.incomplete_details,
    metadata: response.metadata,
    user: response.user,
    output: response.output,
  }
}

/**
 * Parse an OpenAI Responses API SSE chunk into StreamChunk(s).
 *
 * @param chunk - The raw SSE chunk string (e.g., "event: response.output_text.delta\ndata: {...}")
 * @returns The parsed StreamChunk(s), or null if the chunk should be ignored
 */
export function parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
  const trimmed = chunk.trim()

  if (!trimmed || trimmed.startsWith(':')) {
    return null
  }

  let eventType = ''
  let data = ''

  const lines = trimmed.split('\n')
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data = line.slice(5).trim()
    }
  }

  if (!data) {
    if (trimmed.startsWith('{')) {
      data = trimmed
    } else {
      return null
    }
  }

  if (data === '[DONE]') {
    return {
      type: 'done',
      stopReason: 'end_turn',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch (error) {
    logger.trace(
      { chunk: chunk.slice(0, 200), error: String(error) },
      'Failed to parse Responses API chunk'
    )
    return null
  }

  // Check for Standard OpenAI Format (chat.completion.chunk)
  // Some OpenAI Web models might return this format directly (fallback)
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'object' in parsed &&
    (parsed as { object: string }).object === 'chat.completion.chunk'
  ) {
    return parseOpenAIChatStreamChunk(chunk)
  }

  // Responses API Format
  const responsesEvent = parsed as ResponsesStreamEvent
  const type = eventType || responsesEvent.type

  if (!type) {
    // If parsed is a ResponsesStreamEvent structure but missing type in event/json
    if ((parsed as ResponsesStreamEvent).response || (parsed as ResponsesStreamEvent).item) {
      // try to infer from structure or log warning
    }
    logger.debug({ parsed }, 'Unknown event type in openai-responses chunk')
    return null
  }

  return processResponsesEvent(type, responsesEvent)
}

function processResponsesEvent(
  type: string,
  event: ResponsesStreamEvent
): StreamChunk | StreamChunk[] | null {
  switch (type) {
    case 'response.created':
      if (event.response) {
        return {
          type: 'done',
          responseMetadata: extractResponseMetadata(event.response, event.obfuscation),
          skipStopDelta: true,
        }
      }
      return null

    case 'response.in_progress':
      if (event.response) {
        return {
          type: 'done',
          responseMetadata: extractResponseMetadata(event.response, event.obfuscation),
          skipStopDelta: true,
        }
      }
      return null

    case 'response.content_part.added':
      return {
        type: 'content',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        blockType: 'text',
        delta: {},
      }

    case 'response.content_part.done':
      return {
        type: 'block_stop',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        blockType: 'text',
      }

    case 'response.reasoning_summary_part.added':
      return {
        type: 'thinking-start',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        blockType: 'thinking',
      }

    case 'response.reasoning_summary_part.done':
      return {
        type: 'thinking-end',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        blockType: 'thinking',
      }

    case 'response.reasoning_summary_text.done':
      return {
        type: 'thinking-end',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        delta: {
          type: 'thinking',
          thinking: { text: event.text ?? '' },
        },
      }

    case 'response.output_text.done':
      return {
        type: 'block_stop',
        id: event.item_id,
        blockIndex: event.output_index ?? 0,
        delta: {
          type: 'text',
          text: event.text ?? '',
        },
      }

    case 'response.output_text.delta':
      if (event.delta) {
        return {
          type: 'content',
          id: event.item_id,
          blockIndex: event.output_index ?? 0,
          blockType: 'text',
          delta: {
            type: 'text',
            text: event.delta,
          },
        }
      }
      return null

    case 'response.reasoning_summary_text.delta':
      if (event.delta) {
        return {
          type: 'thinking',
          id: event.item_id,
          blockIndex: event.output_index ?? 0,
          blockType: 'thinking',
          delta: {
            type: 'thinking',
            thinking: { text: event.delta },
          },
        }
      }
      return null

    case 'response.function_call_arguments.delta':
      if (event.delta) {
        return {
          type: 'tool_call',
          id: event.item_id,
          blockIndex: event.output_index ?? 0,
          blockType: 'tool_call',
          delta: {
            type: 'tool_call',
            partialJson: event.delta,
            toolCall:
              event.call_id || event.name
                ? {
                    id: event.call_id || '',
                    name: event.name || '',
                    arguments: event.delta,
                  }
                : undefined,
          },
        }
      }
      return null

    case 'response.output_item.added':
      if (event.item) {
        if (event.item.type === 'function_call' && event.item.name) {
          return {
            type: 'tool_call',
            blockIndex: event.output_index ?? 0,
            blockType: 'tool_call',
            delta: {
              type: 'tool_call',
              toolCall: {
                id: event.item.call_id || event.item.id || '',
                name: event.item.name,
                arguments: '',
              },
            },
          }
        }
      }
      return null

    case 'response.output_item.done':
      if (event.item) {
        if (event.item.type === 'function_call') {
          return {
            type: 'tool_call',
            blockIndex: event.output_index ?? 0,
            blockType: 'tool_call',
            delta: {
              type: 'tool_call',
              toolCall: {
                id: event.item.call_id || event.item.id || '',
                name: event.item.name || '',
                arguments: event.item.arguments || '',
              },
            },
          }
        }
        if (event.item.type === 'message' && event.item.content) {
          const textContent = event.item.content.find((c) => c.type === 'output_text')
          if (textContent?.text) {
            return {
              type: 'content',
              blockIndex: event.output_index ?? 0,
              blockType: 'text',
              delta: {
                type: 'text',
                text: textContent.text,
              },
            }
          }
        }
      }
      return null

    case 'response.completed':
      return extractFromCompletedResponse(event.response)

    case 'response.failed':
      return {
        type: 'error',
        error: JSON.stringify(event),
      }

    default:
      return null
  }
}

function extractFromCompletedResponse(
  response?: ResponsesResponse
): StreamChunk | StreamChunk[] | null {
  if (!response) {
    return {
      type: 'done',
      stopReason: 'end_turn',
    }
  }

  const chunks: StreamChunk[] = []

  if (response.output) {
    for (let i = 0; i < response.output.length; i++) {
      const item = response.output[i]
      if (!item) continue

      if (item.type === 'message' && item.content) {
        for (const content of item.content) {
          if (content.type === 'output_text' && content.text) {
            chunks.push({
              type: 'content',
              blockIndex: i,
              blockType: 'text',
              delta: {
                type: 'text',
                text: content.text,
              },
            })
          }
        }
      }

      if (item.type === 'reasoning' && item.summary) {
        for (const summary of item.summary) {
          if (summary.type === 'summary_text' && summary.text) {
            chunks.push({
              type: 'thinking',
              blockIndex: i,
              blockType: 'thinking',
              delta: {
                type: 'thinking',
                thinking: { text: summary.text },
              },
            })
          }
        }
      }

      if (item.type === 'function_call') {
        chunks.push({
          type: 'tool_call',
          blockIndex: i,
          blockType: 'tool_call',
          delta: {
            type: 'tool_call',
            toolCall: {
              id: item.call_id || item.id || '',
              name: item.name || '',
              arguments: item.arguments || '',
            },
          },
        })
      }
    }
  }

  if (response.usage) {
    chunks.push({
      type: 'usage',
      usage: {
        inputTokens: response.usage.input_tokens || 0,
        outputTokens: response.usage.output_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
      },
    })
  }

  chunks.push({
    type: 'done',
    stopReason: response.status === 'completed' ? 'end_turn' : 'error',
  })

  return chunks.length > 0 ? chunks : null
}

/**
 * Transform a Unified StreamChunk back to OpenAI Responses API SSE format.
 * This is the reverse operation of parseStreamChunk for streaming responses.
 */
export function transformStreamChunk(chunk: StreamChunk): string {
  // Build an SSE event in Responses API format
  // The Responses API uses streaming format like: event: response.output_text.delta\ndata: {...}

  switch (chunk.type) {
    case 'content':
      if (chunk.delta?.text) {
        return `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: 'response.output_text.delta',
          delta: chunk.delta.text,
        })}\n\n`
      }
      return ''

    case 'thinking':
      if (chunk.delta?.thinking) {
        return `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({
          type: 'response.reasoning_summary_text.delta',
          delta:
            typeof chunk.delta.thinking === 'string'
              ? chunk.delta.thinking
              : chunk.delta.thinking.text,
        })}\n\n`
      }
      return ''

    case 'thinking-start':
      return `event: response.reasoning_summary_part.added\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_part.added',
        part: { type: 'summary_text' },
      })}\n\n`

    case 'thinking-end':
      return `event: response.reasoning_summary_part.done\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_part.done',
      })}\n\n`

    case 'block_stop':
      return `event: response.content_part.done\ndata: ${JSON.stringify({
        type: 'response.content_part.done',
      })}\n\n`

    case 'tool_call':
      if (chunk.delta?.partialJson) {
        return `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({
          type: 'response.function_call_arguments.delta',
          delta: chunk.delta.partialJson,
        })}\n\n`
      }
      return ''

    case 'usage':
      if (chunk.usage) {
        return `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: chunk.usage.inputTokens,
              output_tokens: chunk.usage.outputTokens,
              total_tokens: chunk.usage.totalTokens,
            },
          },
        })}\n\n`
      }
      return ''

    case 'done':
      return `event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
        },
      })}\n\n`

    case 'error':
      return `event: response.failed\ndata: ${JSON.stringify({
        type: 'response.failed',
        error: {
          message: typeof chunk.error === 'string' ? chunk.error : 'Unknown error',
        },
      })}\n\n`

    default:
      return ''
  }
}
