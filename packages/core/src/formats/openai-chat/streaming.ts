/**
 * OpenAI Chat Streaming Logic
 *
 * Handles parsing and transformation of OpenAI SSE streaming chunks.
 * Self-contained logic, moved from providers/openai/streaming.ts.
 */

import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'
import { createLogger } from '../../util/logger'
import type {
  OpenAIChatDelta,
  OpenAIChatDeltaToolCall,
  OpenAIChatFinishReason,
  OpenAIChatUsage as OpenAIUsage,
} from './types'

const logger = createLogger({ service: 'formats/openai-chat/streaming' })

/**
 * Parse an OpenAI SSE chunk into a StreamChunk.
 *
 * @param chunk - The raw SSE chunk string (e.g., "data: {...}")
 * @returns The parsed StreamChunk, or null if the chunk should be ignored
 */
export function parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
  const trimmed = chunk.trim()

  // Ignore empty lines and keep-alive comments
  if (!trimmed || trimmed.startsWith(':')) {
    return null
  }

  // Must start with "data: ", but we also allow raw JSON for non-compliant providers (like Opencode Zen)
  // Handle "data:" prefix with optional whitespace
  let data = ''
  if (trimmed.startsWith('data:')) {
    data = trimmed.slice(5).trim()
  } else if (trimmed.startsWith('{')) {
    // If it starts with {, it's a raw JSON object string
    data = trimmed
  } else if (trimmed.includes('data:')) {
    // Handle chunks that might contain 'event: ...\ndata: ...' or just 'data: ...' inside
    const dataMatch = trimmed.match(/^data:\s*(.+)$/m)
    if (dataMatch?.[1]) {
      data = dataMatch[1].trim()
    } else {
      return null
    }
  } else {
    // Other lines are ignored
    return null
  }

  // Handle [DONE] signal
  if (data === '[DONE]') {
    return {
      type: 'done',
      stopReason: 'end_turn',
    }
  }

  // Parse JSON
  let parsed: {
    content?: string
    usage?: OpenAIUsage
    model?: string // Extract model from response
    choices?: {
      index?: number
      delta?: OpenAIChatDelta
      finish_reason?: OpenAIChatFinishReason
      message?: OpenAIChatDelta // Non-standard fallback
    }[]
    finish_reason?: OpenAIChatFinishReason // Top-level finish_reason
  }

  try {
    parsed = JSON.parse(data) as typeof parsed
  } catch (error) {
    return {
      type: 'error',
      error: `Failed to parse stream chunk: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }

  // Handle non-standard formats where content is at top level (some providers/GLM)
  const chunks: StreamChunk[] = []

  if (parsed.content !== undefined && typeof parsed.content === 'string') {
    chunks.push({
      type: 'content',
      model: parsed.model,
      delta: {
        type: 'text',
        text: parsed.content,
      },
    })
  }

  // Handle usage
  if (parsed.usage) {
    chunks.push({
      type: 'usage',
      model: parsed.model,
      usage: parseUsage(parsed.usage),
    })
  }

  // Handle top-level finish_reason (if no choices or choices are empty)
  if (parsed.finish_reason && (!parsed.choices || parsed.choices.length === 0)) {
    chunks.push({
      type: 'done',
      model: parsed.model,
      stopReason: parseFinishReason(parsed.finish_reason),
    })
  }

  // Handle choices
  if (parsed.choices && parsed.choices.length > 0) {
    const choice = parsed.choices[0]
    if (choice) {
      const blockIndex = choice.index ?? 0
      const delta: OpenAIChatDelta = choice.delta || choice.message || {}

      // Handle tool calls in delta
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        const firstToolCall = delta.tool_calls[0]
        if (firstToolCall) {
          const toolChunk = parseToolCallDelta(firstToolCall, blockIndex)
          toolChunk.model = parsed.model
          chunks.push(toolChunk)
        }
      }

      // Handle content delta
      if (delta.content !== undefined) {
        chunks.push({
          type: 'content',
          blockIndex,
          blockType: 'text',
          model: parsed.model,
          delta: {
            type: 'text',
            text: delta.content,
          },
        })
      }

      // Handle reasoning/thinking delta
      if (delta.reasoning_content !== undefined) {
        chunks.push({
          type: 'thinking',
          blockIndex,
          blockType: 'thinking',
          model: parsed.model,
          delta: {
            type: 'thinking',
            thinking: {
              text: delta.reasoning_content,
            },
          },
        })
      }

      // Handle finish reason in choice
      if (choice.finish_reason) {
        chunks.push({
          type: 'done',
          blockIndex,
          model: parsed.model,
          stopReason: parseFinishReason(choice.finish_reason),
        })
      }
    }
  }

  if (chunks.length === 0) {
    return null
  }

  if (chunks.length === 1) {
    return chunks[0] ?? null
  }

  return chunks
}

/**
 * Transform a StreamChunk into an OpenAI SSE chunk string.
 *
 * @param chunk - The StreamChunk to transform
 * @param modelOverride - Optional model name to use instead of chunk.model or default
 * @returns The SSE-formatted string
 */
export function transformStreamChunk(chunk: StreamChunk, modelOverride?: string): string {
  const id = `chatcmpl-${generateId()}`
  const created = Math.floor(Date.now() / 1000)
  const index = chunk.blockIndex ?? 0
  const model = modelOverride || chunk.model

  switch (chunk.type) {
    case 'content':
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index,
            delta: { content: chunk.delta?.text || '' },
            finish_reason: null,
          },
        ],
      })

    case 'text-delta':
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index,
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
        model,
        choices: [
          {
            index,
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
        model,
        choices: [
          {
            index,
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
        model,
        choices: [],
        usage: transformUsage(chunk.usage),
      })

    case 'thinking':
    case 'thinking-delta':
      // Use reasoning_content for thinking chunks (O1/O3 compatible)
      return formatSSE({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index,
            delta: { reasoning_content: chunk.delta?.thinking?.text || '' },
            finish_reason: null,
          },
        ],
      })

    case 'thinking-start':
    case 'thinking-end':
      // OpenAI streaming doesn't support start/end events for thinking
      // Return empty string to be ignored by builder
      return ''

    case 'block_stop':
      // OpenAI doesn't have explicit block_stop, but we can simulate it with empty delta if needed
      // or simply ignore it as it doesn't carry content.
      // For now, we'll return an empty string/comment to keep the stream alive but do nothing.
      return ': block_stop'

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

function parseToolCallDelta(toolCall: OpenAIChatDeltaToolCall, blockIndex: number): StreamChunk {
  // For streaming, arguments come as incremental JSON strings
  // We store them in partialJson for proper cross-provider accumulation
  const args = toolCall.function?.arguments || ''

  // Debug logging for tool call parsing
  logger.trace(
    {
      toolId: toolCall.id,
      toolName: toolCall.function?.name,
      argsPreview: args.slice(0, 100),
      hasArgs: !!args,
    },
    '[OPENAI] parseToolCallDelta'
  )

  // If we have an ID and name, emit a complete tool_call with the partial JSON
  if ((toolCall.id || toolCall.function?.name) && args) {
    return {
      type: 'tool_call',
      blockIndex,
      blockType: 'tool_call',
      delta: {
        type: 'tool_call',
        partialJson: args,
        toolCall:
          toolCall.id || toolCall.function?.name
            ? {
                id: toolCall.id || '',
                name: toolCall.function?.name || '',
                arguments: args,
              }
            : undefined,
      },
    }
  }

  // Emit just the incremental JSON without full tool call info
  if (args) {
    return {
      type: 'tool_call',
      blockIndex,
      blockType: 'tool_call',
      delta: {
        type: 'tool_call',
        partialJson: args,
      },
    }
  }

  // Fallback for tool call header (ID and name only, no arguments yet)
  return {
    type: 'tool_call',
    blockIndex,
    blockType: 'tool_call',
    delta: {
      type: 'tool_call',
      toolCall: {
        id: toolCall.id || '',
        name: toolCall.function?.name || '',
        arguments: '',
      },
    },
  }
}

function transformToolCallDelta(chunk: StreamChunk): OpenAIChatDeltaToolCall {
  const partialJson = chunk.delta?.partialJson
  const toolCall = chunk.delta?.toolCall

  const result: OpenAIChatDeltaToolCall = {
    index: 0,
  }

  // Handle partialJson streaming (incremental JSON arguments)
  if (partialJson) {
    logger.trace(
      { partialJsonPreview: partialJson.slice(0, 100) },
      '[OPENAI] transform partialJson'
    )
    result.function = {
      arguments: partialJson,
    }

    // If we have toolCall info, add it to the result
    if (toolCall?.id) {
      result.id = toolCall.id
      result.type = 'function'
    }

    if (toolCall?.name) {
      result.function.name = toolCall.name
    }

    return result
  }

  // Handle full tool call transformation (non-streaming or initial emit)
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

function parseFinishReason(reason: OpenAIChatFinishReason): StopReason {
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

function transformStopReason(reason: StopReason): OpenAIChatFinishReason {
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
  // Defensive check for usage object
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
  }

  // Safe access to usage properties
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
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
