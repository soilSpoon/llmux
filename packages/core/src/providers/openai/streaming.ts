/**
 * OpenAI Streaming Transformations
 *
 * Handles parsing and transformation of OpenAI SSE streaming chunks.
 */

import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'
import type {
  OpenAIDeltaToolCall,
  OpenAIFinishReason,
  OpenAIStreamChunk,
  OpenAIUsage,
} from './types'

/**
 * Parse an OpenAI SSE chunk into a StreamChunk.
 *
 * @param chunk - The raw SSE chunk string (e.g., "data: {...}")
 * @returns The parsed StreamChunk, or null if the chunk should be ignored
 */
export function parseStreamChunk(chunk: string): StreamChunk | null {
  const trimmed = chunk.trim()

  // Ignore empty lines and keep-alive comments
  if (!trimmed || trimmed.startsWith(':')) {
    return null
  }

  // Must start with "data: "
  if (!trimmed.startsWith('data: ')) {
    return null
  }

  const data = trimmed.slice(6) // Remove "data: " prefix

  // Handle [DONE] signal
  if (data === '[DONE]') {
    return {
      type: 'done',
      stopReason: 'end_turn',
    }
  }

  // Parse JSON
  let parsed: OpenAIStreamChunk
  try {
    parsed = JSON.parse(data)
  } catch (error) {
    return {
      type: 'error',
      error: `Failed to parse stream chunk: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Handle usage-only chunk (no choices, just usage)
  if (parsed.usage && (!parsed.choices || parsed.choices.length === 0)) {
    return {
      type: 'usage',
      usage: parseUsage(parsed.usage),
    }
  }

  // Handle empty choices
  if (!parsed.choices || parsed.choices.length === 0) {
    return null
  }

  const choice = parsed.choices[0]
  if (!choice) {
    return null
  }

  // Handle finish reason
  if (choice.finish_reason) {
    return {
      type: 'done',
      stopReason: parseFinishReason(choice.finish_reason),
    }
  }

  // Handle tool calls in delta
  if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
    const firstToolCall = choice.delta.tool_calls[0]
    if (firstToolCall) {
      return parseToolCallDelta(firstToolCall)
    }
  }

  // Handle content delta
  if (choice.delta.content !== undefined) {
    return {
      type: 'content',
      delta: {
        type: 'text',
        text: choice.delta.content,
      },
    }
  }

  // Empty delta (e.g., role-only first chunk with no content)
  if (choice.delta.role && !choice.delta.content && !choice.delta.tool_calls) {
    return null
  }

  return null
}

/**
 * Transform a StreamChunk into an OpenAI SSE chunk string.
 *
 * @param chunk - The StreamChunk to transform
 * @returns The SSE-formatted string
 */
export function transformStreamChunk(chunk: StreamChunk): string {
  const id = `chatcmpl-${generateId()}`
  const created = Math.floor(Date.now() / 1000)

  switch (chunk.type) {
    case 'content':
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { content: chunk.delta?.text || '' },
            finish_reason: null,
          },
        ],
      })

    case 'done':
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: transformStopReason(chunk.stopReason || null),
          },
        ],
      })

    case 'tool_call':
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [transformToolCallDelta(chunk)],
            },
            finish_reason: null,
          },
        ],
      })

    case 'usage':
      if (!chunk.usage) {
        return ''
      }
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gpt-4',
        choices: [],
        usage: transformUsage(chunk.usage),
      })

    case 'thinking':
      // OpenAI streaming doesn't have explicit thinking chunks
      // We could potentially use reasoning_content in the delta
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { content: chunk.delta?.thinking?.text || '' },
            finish_reason: null,
          },
        ],
      })

    case 'error':
      // Error chunks - just send [DONE]
      return 'data: [DONE]'

    default:
      return 'data: [DONE]'
  }
}

// =============================================================================
// Tool Call Parsing
// =============================================================================

function parseToolCallDelta(toolCall: OpenAIDeltaToolCall): StreamChunk {
  // For streaming, arguments come as incremental strings
  // We store the raw string for accumulation at the consumer level
  const args = toolCall.function?.arguments || ''

  return {
    type: 'tool_call',
    delta: {
      type: 'tool_call',
      toolCall: {
        id: toolCall.id || '',
        name: toolCall.function?.name || '',
        // Store raw string in a wrapper - consumer will accumulate and parse
        arguments: args as unknown as Record<string, unknown>,
      },
    },
  }
}

function transformToolCallDelta(chunk: StreamChunk): OpenAIDeltaToolCall {
  const toolCall = chunk.delta?.toolCall

  const result: OpenAIDeltaToolCall = {
    index: 0,
  }

  if (toolCall?.id) {
    result.id = toolCall.id
    result.type = 'function'
  }

  if (toolCall?.name || toolCall?.arguments) {
    result.function = {}

    if (toolCall.name) {
      result.function.name = toolCall.name
    }

    if (toolCall.arguments) {
      // Arguments could be a string (incremental) or object
      result.function.arguments =
        typeof toolCall.arguments === 'string'
          ? toolCall.arguments
          : JSON.stringify(toolCall.arguments)
    }
  }

  return result
}

// =============================================================================
// Stop Reason Conversions
// =============================================================================

function parseFinishReason(reason: OpenAIFinishReason): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'content_filter'
    case null:
      return null
    default:
      return null
  }
}

function transformStopReason(reason: StopReason): OpenAIFinishReason {
  switch (reason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'content_filter':
      return 'content_filter'
    case 'stop_sequence':
      return 'stop'
    case 'error':
      return null
    case null:
      return null
    default:
      return null
  }
}

// =============================================================================
// Usage Conversions
// =============================================================================

function parseUsage(usage: OpenAIUsage): UsageInfo {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  }
}

function transformUsage(usage: UsageInfo): OpenAIUsage {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}`
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}
