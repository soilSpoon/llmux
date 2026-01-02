/**
 * Anthropic Response Transformations
 *
 * Handles bidirectional transformation between UnifiedResponse and AnthropicResponse
 */

import type {
  ContentPart,
  StopReason,
  ThinkingBlock,
  UnifiedResponse,
  UsageInfo,
} from '../../types/unified'
import type {
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  AnthropicUsage,
} from './types'
import { isAnthropicResponse } from './types'

/**
 * Parse AnthropicResponse into UnifiedResponse
 */
export function parseResponse(response: unknown): UnifiedResponse {
  if (!isAnthropicResponse(response)) {
    throw new Error('Invalid Anthropic response: missing required fields')
  }

  const anthropic = response as AnthropicResponse

  const content = parseContentBlocks(anthropic.content)
  const thinking = extractThinkingBlocks(anthropic.content)

  return {
    id: anthropic.id,
    content,
    stopReason: parseStopReason(anthropic.stop_reason),
    usage: parseUsage(anthropic.usage),
    model: anthropic.model,
    thinking: thinking.length > 0 ? thinking : undefined,
  }
}

/**
 * Transform UnifiedResponse into AnthropicResponse
 */
export function transformResponse(response: UnifiedResponse): AnthropicResponse {
  const content: AnthropicContentBlock[] = transformContentParts(response.content)

  // Add thinking blocks if they exist and are not already in content
  if (response.thinking && response.thinking.length > 0) {
    const hasThinkingInContent = response.content.some((p) => p.type === 'thinking')
    if (!hasThinkingInContent) {
      for (const block of response.thinking) {
        content.unshift({
          type: 'thinking',
          thinking: block.text,
          signature: block.signature || '',
        })
      }
    }
  }

  // If content is still empty but we have thinking, it should have been added above.
  // If content is empty and no thinking, we might need a fallback, but usually
  // LLMs return at least something.

  return {
    id: response.id || generateMessageId(),
    type: 'message',
    role: 'assistant',
    model: response.model || 'claude-sonnet-4-20250514',
    content,
    stop_reason: transformStopReason(response.stopReason),
    stop_sequence: null,
    usage: transformUsage(response.usage),
  }
}

// =============================================================================
// Parse Helpers
// =============================================================================

function parseContentBlocks(blocks: AnthropicContentBlock[]): ContentPart[] {
  return blocks.map(parseContentBlock).filter((part): part is ContentPart => part !== null)
}

function parseContentBlock(block: AnthropicContentBlock): ContentPart | null {
  switch (block.type) {
    case 'text':
      return {
        type: 'text',
        text: (block as AnthropicTextBlock).text,
      }

    case 'tool_use': {
      const toolUse = block as AnthropicToolUseBlock
      return {
        type: 'tool_call',
        toolCall: {
          id: toolUse.id,
          name: toolUse.name,
          arguments: toolUse.input,
        },
      }
    }

    case 'thinking': {
      const thinking = block as AnthropicThinkingBlock
      return {
        type: 'thinking',
        thinking: {
          text: thinking.thinking,
          signature: thinking.signature,
        },
      }
    }

    case 'redacted_thinking': {
      return {
        type: 'thinking',
        thinking: {
          text: '',
          redacted: true,
        },
      }
    }

    case 'tool_result': {
      const toolResult = block as AnthropicToolResultBlock
      let content: string
      if (typeof toolResult.content === 'string') {
        content = toolResult.content
      } else if (Array.isArray(toolResult.content)) {
        content = toolResult.content
          .filter((c): c is AnthropicTextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      } else {
        content = ''
      }
      return {
        type: 'tool_result',
        toolResult: {
          toolCallId: toolResult.tool_use_id,
          content,
          isError: toolResult.is_error,
        },
      }
    }

    default:
      return null
  }
}

function extractThinkingBlocks(blocks: AnthropicContentBlock[]): ThinkingBlock[] {
  const thinkingBlocks: ThinkingBlock[] = []

  for (const block of blocks) {
    if (block.type === 'thinking') {
      const thinking = block as AnthropicThinkingBlock
      thinkingBlocks.push({
        text: thinking.thinking,
        signature: thinking.signature,
      })
    } else if (block.type === 'redacted_thinking') {
      thinkingBlocks.push({
        text: '',
        redacted: true,
      })
    }
  }

  return thinkingBlocks
}

function parseStopReason(reason: AnthropicStopReason): StopReason {
  // Anthropic stop reasons map directly to unified stop reasons
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'stop_sequence':
      return 'stop_sequence'
    case null:
      return null
    default:
      return null
  }
}

function parseUsage(usage: AnthropicUsage): UsageInfo {
  const cachedTokens =
    (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
  }
}

// =============================================================================
// Transform Helpers
// =============================================================================

function transformContentParts(parts: ContentPart[]): AnthropicContentBlock[] {
  return parts
    .map(transformContentPart)
    .filter((block): block is AnthropicContentBlock => block !== null)
}

function transformContentPart(part: ContentPart): AnthropicContentBlock | null {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text || '',
      }

    case 'tool_call':
      if (!part.toolCall) return null
      return {
        type: 'tool_use',
        id: part.toolCall.id,
        name: part.toolCall.name,
        input:
          typeof part.toolCall.arguments === 'string'
            ? { value: part.toolCall.arguments }
            : part.toolCall.arguments,
      }

    case 'thinking':
      if (!part.thinking) return null
      return {
        type: 'thinking',
        thinking: part.thinking.text,
        signature: part.thinking.signature || '',
      }

    default:
      return null
  }
}

function transformStopReason(reason: StopReason): AnthropicStopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'stop_sequence':
      return 'stop_sequence'
    case 'content_filter':
      return 'end_turn' // Anthropic doesn't have content_filter, map to end_turn
    case 'error':
      return null
    case null:
      return null
    default:
      return null
  }
}

function transformUsage(usage?: UsageInfo): AnthropicUsage {
  const result: AnthropicUsage = {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
  }

  if (usage?.cachedTokens) {
    result.cache_read_input_tokens = usage.cachedTokens
  }

  return result
}

function generateMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2, 11)}${Math.random().toString(36).slice(2, 11)}`
}

export function extractSignatureFromResponse(response: AnthropicResponse): string | null {
  const thinkingBlock = response.content.find(
    (block): block is AnthropicThinkingBlock => block.type === 'thinking'
  )
  return thinkingBlock?.signature ?? null
}
