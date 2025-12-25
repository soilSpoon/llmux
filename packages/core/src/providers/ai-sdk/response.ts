/**
 * AI SDK Response Transformations
 *
 * Handles bidirectional transformation between AI SDK LanguageModelV3GenerateResult
 * and UnifiedResponse.
 */

import type {
  LanguageModelV3Content,
  LanguageModelV3File,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Reasoning,
  LanguageModelV3Text,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import type {
  ContentPart,
  StopReason,
  ThinkingBlock,
  UnifiedResponse,
  UsageInfo,
} from '../../types/unified'

// =============================================================================
// Parse: AI SDK → Unified
// =============================================================================

/**
 * Parse AI SDK LanguageModelV3GenerateResult into UnifiedResponse format.
 *
 * @param result - The AI SDK generate result to parse
 * @returns The parsed UnifiedResponse
 */
export function parseResponse(result: LanguageModelV3GenerateResult): UnifiedResponse {
  const response: UnifiedResponse = {
    id: result.response?.id || generateId(),
    content: [],
    stopReason: parseFinishReason(result.finishReason),
    model: result.response?.modelId,
  }

  // Parse content
  const thinkingBlocks: ThinkingBlock[] = []

  for (const part of result.content) {
    const parsed = parseContentPart(part)
    if (parsed.isThinking && parsed.thinking) {
      thinkingBlocks.push(parsed.thinking)
    } else if (parsed.content) {
      response.content.push(parsed.content)
    }
  }

  if (thinkingBlocks.length > 0) {
    response.thinking = thinkingBlocks
  }

  // Parse usage
  if (result.usage) {
    response.usage = parseUsage(result.usage)
  }

  return response
}

/**
 * Transform a UnifiedResponse into AI SDK LanguageModelV3GenerateResult format.
 *
 * @param response - The UnifiedResponse to transform
 * @returns The AI SDK generate result
 */
export function transformResponse(response: UnifiedResponse): LanguageModelV3GenerateResult {
  const content: LanguageModelV3Content[] = []

  // Add thinking blocks as reasoning content
  if (response.thinking) {
    for (const block of response.thinking) {
      content.push({
        type: 'reasoning',
        text: block.text,
      })
    }
  }

  // Transform content parts
  for (const part of response.content) {
    const transformed = transformContentPart(part)
    if (transformed) {
      content.push(transformed)
    }
  }

  const result: LanguageModelV3GenerateResult = {
    content,
    finishReason: transformStopReason(response.stopReason),
    usage: transformUsage(response.usage || { inputTokens: 0, outputTokens: 0 }),
    warnings: [],
  }

  // Add response metadata
  if (response.id || response.model) {
    result.response = {
      id: response.id,
      modelId: response.model,
      timestamp: new Date(),
    }
  }

  return result
}

// =============================================================================
// Content Parsing (AI SDK → Unified)
// =============================================================================

interface ParsedContent {
  content?: ContentPart
  thinking?: ThinkingBlock
  isThinking: boolean
}

function parseContentPart(part: LanguageModelV3Content): ParsedContent {
  switch (part.type) {
    case 'text':
      return {
        content: { type: 'text', text: (part as LanguageModelV3Text).text },
        isThinking: false,
      }

    case 'reasoning':
      return {
        thinking: { text: (part as LanguageModelV3Reasoning).text },
        isThinking: true,
      }

    case 'tool-call': {
      const toolCall = part as LanguageModelV3ToolCall
      return {
        content: {
          type: 'tool_call',
          toolCall: {
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            arguments: safeJsonParse(toolCall.input),
          },
        },
        isThinking: false,
      }
    }

    case 'file': {
      const file = part as LanguageModelV3File
      const data = file.data instanceof Uint8Array ? uint8ArrayToBase64(file.data) : file.data
      return {
        content: {
          type: 'image',
          image: {
            mimeType: file.mediaType,
            data,
          },
        },
        isThinking: false,
      }
    }

    default:
      // source, tool-approval-request, tool-result - ignore or handle as needed
      return { isThinking: false }
  }
}

// =============================================================================
// Content Transformation (Unified → AI SDK)
// =============================================================================

function transformContentPart(part: ContentPart): LanguageModelV3Content | null {
  switch (part.type) {
    case 'text':
      if (!part.text) return null
      return { type: 'text', text: part.text }

    case 'tool_call':
      if (!part.toolCall) return null
      return {
        type: 'tool-call',
        toolCallId: part.toolCall.id,
        toolName: part.toolCall.name,
        input: JSON.stringify(part.toolCall.arguments),
      }

    case 'image':
      if (!part.image) return null
      return {
        type: 'file',
        mediaType: part.image.mimeType,
        data: part.image.data || part.image.url || '',
      }

    case 'thinking':
      if (!part.thinking) return null
      return { type: 'reasoning', text: part.thinking.text }

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

  // Extract cached tokens
  if (usage.inputTokens.cacheRead !== undefined) {
    result.cachedTokens = usage.inputTokens.cacheRead
  }

  // Extract thinking/reasoning tokens
  if (usage.outputTokens.reasoning !== undefined) {
    result.thinkingTokens = usage.outputTokens.reasoning
  }

  return result
}

function transformUsage(usage: UsageInfo): LanguageModelV3Usage {
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
  return `resp_${Math.random().toString(36).slice(2, 11)}`
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] as number)
  }
  return btoa(binary)
}
