/**
 * OpenAI Response Transformations
 *
 * Handles bidirectional transformation between OpenAI response format and UnifiedResponse.
 */

import type { ContentPart, StopReason, UnifiedResponse, UsageInfo } from '../../types/unified'
import type {
  OpenAIFinishReason,
  OpenAIResponse,
  OpenAIResponseMessage,
  OpenAIToolCall,
  OpenAIUsage,
} from './types'

/**
 * Parse an OpenAI response into UnifiedResponse format.
 *
 * @param response - The OpenAI response to parse
 * @returns The parsed UnifiedResponse
 */
export function parseResponse(response: OpenAIResponse): UnifiedResponse {
  const result: UnifiedResponse = {
    id: response.id,
    content: [],
    stopReason: null,
    model: response.model,
  }

  // Handle empty choices
  if (!response.choices || response.choices.length === 0) {
    return result
  }

  const choice = response.choices[0]
  if (!choice) {
    return result
  }

  // Parse content from message
  result.content = parseMessageContent(choice.message)

  // Parse stop reason
  result.stopReason = parseFinishReason(choice.finish_reason)

  // Parse usage
  if (response.usage) {
    result.usage = parseUsage(response.usage)
  }

  // Parse thinking/reasoning
  if (choice.message.reasoning_content) {
    result.thinking = [{ text: choice.message.reasoning_content }]
  }

  return result
}

/**
 * Transform a UnifiedResponse into OpenAI response format.
 *
 * @param response - The UnifiedResponse to transform
 * @returns The OpenAI response
 */
export function transformResponse(response: UnifiedResponse): OpenAIResponse {
  const message = transformMessage(response)

  const result: OpenAIResponse = {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model || 'gpt-4',
    choices: [
      {
        index: 0,
        message,
        finish_reason: transformStopReason(response.stopReason),
      },
    ],
  }

  // Transform usage
  if (response.usage) {
    result.usage = transformUsage(response.usage)
  }

  // Transform thinking
  if (response.thinking && response.thinking.length > 0) {
    const firstChoice = result.choices[0]
    if (firstChoice) {
      firstChoice.message.reasoning_content = response.thinking.map((t) => t.text).join('\n\n')
    }
  }

  return result
}

// =============================================================================
// Message Content Parsing
// =============================================================================

function parseMessageContent(message: OpenAIResponseMessage): ContentPart[] {
  const parts: ContentPart[] = []

  // Add text content (skip if empty or whitespace-only)
  if (message.content && message.content.trim() !== '') {
    parts.push({
      type: 'text',
      text: message.content,
    })
  }

  // Add tool calls
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      parts.push(parseToolCall(toolCall))
    }
  }

  return parts
}

function parseToolCall(toolCall: OpenAIToolCall): ContentPart {
  return {
    type: 'tool_call',
    toolCall: {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: safeJsonParse(toolCall.function.arguments),
    },
  }
}

// =============================================================================
// Message Transformation
// =============================================================================

function transformMessage(response: UnifiedResponse): OpenAIResponseMessage {
  let textContent = response.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')

  const toolCalls = response.content
    .filter(
      (
        p
      ): p is ContentPart & {
        toolCall: NonNullable<ContentPart['toolCall']>
      } => p.type === 'tool_call' && p.toolCall !== undefined
    )
    .map((p) => p.toolCall)

  // If content and tool calls are empty, but we have thinking, use thinking as content
  if (!textContent && toolCalls.length === 0 && response.thinking && response.thinking.length > 0) {
    textContent = response.thinking.map((t) => t.text).join('\n\n')
  }

  const message: OpenAIResponseMessage = {
    role: 'assistant',
    content: textContent || null,
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map(
      (tc): OpenAIToolCall => ({
        id: tc.id ?? '',
        type: 'function',
        function: {
          name: tc.name ?? '',
          arguments: JSON.stringify(tc.arguments),
        },
      })
    )

    // If there's no text content and only tool calls, set content to null
    if (!textContent) {
      message.content = null
    }
  }

  return message
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
  const result: UsageInfo = {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }

  // Extract cached tokens
  if (usage.prompt_tokens_details?.cached_tokens) {
    result.cachedTokens = usage.prompt_tokens_details.cached_tokens
  }

  // Extract thinking/reasoning tokens
  if (usage.completion_tokens_details?.reasoning_tokens) {
    result.thinkingTokens = usage.completion_tokens_details.reasoning_tokens
  }

  return result
}

function transformUsage(usage: UsageInfo): OpenAIUsage {
  const result: OpenAIUsage = {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  }

  // Add token details if present
  if (usage.cachedTokens) {
    result.prompt_tokens_details = {
      cached_tokens: usage.cachedTokens,
    }
  }

  if (usage.thinkingTokens) {
    result.completion_tokens_details = {
      reasoning_tokens: usage.thinkingTokens,
    }
  }

  return result
}

// =============================================================================
// Utility Functions
// =============================================================================

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
