/**
 * AI SDK Streaming Transformations
 *
 * Handles bidirectional transformation between AI SDK LanguageModelV3StreamPart
 * and unified StreamChunk.
 */

import type {
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'

// =============================================================================
// Parse: AI SDK → Unified
// =============================================================================

/**
 * Parse an AI SDK LanguageModelV3StreamPart into a unified StreamChunk.
 *
 * @param part - The AI SDK stream part to parse
 * @returns The parsed StreamChunk, or null if should be ignored
 */
export function parseStreamPart(part: LanguageModelV3StreamPart): StreamChunk | null {
  switch (part.type) {
    case 'text-delta':
      return {
        type: 'content',
        delta: {
          type: 'text',
          text: part.delta,
        },
      }

    case 'text-start':
    case 'text-end':
      // Lifecycle events - ignore for now
      return null

    case 'reasoning-delta':
      return {
        type: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: part.delta },
        },
      }

    case 'reasoning-start':
    case 'reasoning-end':
      // Lifecycle events - ignore for now
      return null

    case 'tool-input-start':
      return {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: part.id,
            name: part.toolName,
            arguments: {},
          },
        },
      }

    case 'tool-input-delta':
      return {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: part.id,
            name: '',
            // Store raw string for accumulation
            arguments: part.delta as unknown as Record<string, unknown>,
          },
        },
      }

    case 'tool-input-end':
      return null

    case 'tool-call':
      return {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: part.toolCallId,
            name: part.toolName,
            arguments: safeJsonParse(part.input),
          },
        },
      }

    case 'finish':
      return {
        type: 'done',
        stopReason: parseFinishReason(part.finishReason),
        usage: parseUsage(part.usage),
      }

    case 'stream-start':
      // Ignore stream start
      return null

    case 'response-metadata':
      // Ignore response metadata for now
      return null

    default:
      // file, source, tool-result, tool-approval-request - ignore or handle as needed
      return null
  }
}

/**
 * Transform a unified StreamChunk into AI SDK LanguageModelV3StreamPart.
 *
 * @param chunk - The StreamChunk to transform
 * @returns The AI SDK stream part, or null if cannot be transformed
 */
export function transformStreamPart(chunk: StreamChunk): LanguageModelV3StreamPart | null {
  switch (chunk.type) {
    case 'content':
      if (chunk.delta?.text) {
        return {
          type: 'text-delta',
          id: generateId(),
          delta: chunk.delta.text,
        }
      }
      return null

    case 'thinking':
      if (chunk.delta?.thinking?.text) {
        return {
          type: 'reasoning-delta',
          id: generateId(),
          delta: chunk.delta.thinking.text,
        }
      }
      return null

    case 'tool_call':
      if (chunk.delta?.toolCall) {
        const tc = chunk.delta.toolCall
        // For complete tool calls
        if (tc.name && tc.id) {
          return {
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.name,
            input: JSON.stringify(tc.arguments),
          }
        }
        // For streaming tool input deltas
        if (typeof tc.arguments === 'string') {
          return {
            type: 'tool-input-delta',
            id: tc.id || '',
            delta: tc.arguments,
          }
        }
      }
      return null

    case 'done':
      return {
        type: 'finish',
        usage: transformUsage(chunk.usage),
        finishReason: transformStopReason(chunk.stopReason || null),
      }

    case 'usage':
      if (chunk.usage) {
        return {
          type: 'finish',
          usage: transformUsage(chunk.usage),
          finishReason: { unified: 'other', raw: undefined },
        }
      }
      return null

    case 'error':
      return {
        type: 'finish',
        usage: {
          inputTokens: {
            total: 0,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 0, text: undefined, reasoning: undefined },
        },
        finishReason: { unified: 'error', raw: chunk.error },
      }

    default:
      return null
  }
}

// =============================================================================
// Finish Reason Conversions
// =============================================================================

function parseFinishReason(reason: LanguageModelV3FinishReason): StopReason {
  switch (reason.unified) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool-calls':
      return 'tool_use'
    case 'content-filter':
      return 'content_filter'
    case 'error':
      return 'error'
    case 'other':
      return null
    default:
      return null
  }
}

function transformStopReason(reason: StopReason): LanguageModelV3FinishReason {
  const mapping: Record<string, LanguageModelV3FinishReason['unified']> = {
    end_turn: 'stop',
    max_tokens: 'length',
    tool_use: 'tool-calls',
    content_filter: 'content-filter',
    stop_sequence: 'stop',
    error: 'error',
  }

  const unified = reason ? mapping[reason] || 'other' : 'other'

  return {
    unified,
    raw: reason || undefined,
  }
}

// =============================================================================
// Usage Conversions
// =============================================================================

function parseUsage(usage: LanguageModelV3Usage): UsageInfo {
  const inputTotal = usage.inputTokens.total ?? 0
  const outputTotal = usage.outputTokens.total ?? 0

  const result: UsageInfo = {
    inputTokens: inputTotal,
    outputTokens: outputTotal,
    totalTokens: inputTotal + outputTotal,
  }

  if (usage.inputTokens.cacheRead !== undefined) {
    result.cachedTokens = usage.inputTokens.cacheRead
  }

  if (usage.outputTokens.reasoning !== undefined) {
    result.thinkingTokens = usage.outputTokens.reasoning
  }

  return result
}

function transformUsage(usage: UsageInfo | undefined): LanguageModelV3Usage {
  if (!usage) {
    return {
      inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: undefined, reasoning: undefined },
    }
  }

  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache:
        usage.cachedTokens !== undefined ? usage.inputTokens - usage.cachedTokens : undefined,
      cacheRead: usage.cachedTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text:
        usage.thinkingTokens !== undefined ? usage.outputTokens - usage.thinkingTokens : undefined,
      reasoning: usage.thinkingTokens,
    },
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
