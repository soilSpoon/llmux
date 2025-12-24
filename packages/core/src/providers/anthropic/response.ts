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
  return {
    id: response.id || generateMessageId(),
    type: 'message',
    role: 'assistant',
    model: response.model || 'claude-sonnet-4-20250514',
    content: transformContentParts(response.content),
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

    case 'redacted_thinking':
      // Skip redacted thinking - cannot be displayed
      return null

    default:
      return null
  }
}

function extractThinkingBlocks(blocks: AnthropicContentBlock[]): ThinkingBlock[] {
  return blocks
    .filter((block): block is AnthropicThinkingBlock => block.type === 'thinking')
    .map((block) => ({
      text: block.thinking,
      signature: block.signature,
    }))
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
        input: part.toolCall.arguments,
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
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
  }
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
