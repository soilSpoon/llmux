/**
 * Gemini Response Transformations
 * Handles bidirectional conversion between UnifiedResponse and GeminiResponse
 */

import type {
  ContentPart,
  StopReason,
  ThinkingBlock,
  UnifiedResponse,
  UsageInfo,
} from '../../types/unified'
import type { GeminiFinishReason, GeminiPart, GeminiResponse, GeminiUsageMetadata } from './types'

/**
 * Parse GeminiResponse into UnifiedResponse
 */
export function parseResponse(response: GeminiResponse): UnifiedResponse {
  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts ?? []

  // Separate thinking parts from content parts
  const thinkingParts = parts.filter((p) => p.thought === true)
  const contentParts = parts.filter((p) => p.thought !== true)

  // Parse content parts
  const content = contentParts.map(parseContentPart)

  // Parse thinking parts
  const thinking = thinkingParts.map(parseThinkingPart)

  // Determine stop reason
  const hasFunctionCall = contentParts.some((p) => p.functionCall)
  const stopReason = mapFinishReason(candidate?.finishReason, hasFunctionCall)

  // Parse usage
  const usage = parseUsageMetadata(response.usageMetadata)

  const result: UnifiedResponse = {
    id: response.responseId || generateId(),
    content,
    stopReason,
  }

  if (usage) result.usage = usage
  if (thinking.length > 0) result.thinking = thinking

  return result
}

/**
 * Transform UnifiedResponse into GeminiResponse
 */
export function transformResponse(response: UnifiedResponse): GeminiResponse {
  const parts: GeminiPart[] = []

  // Add thinking parts first
  if (response.thinking) {
    for (const thinking of response.thinking) {
      parts.push({
        thought: true,
        text: thinking.text,
        thoughtSignature: thinking.signature,
      })
    }
  }

  // Add content parts
  for (const part of response.content) {
    parts.push(transformContentPart(part))
  }

  const result: GeminiResponse = {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
        finishReason: mapStopReason(response.stopReason),
      },
    ],
    responseId: response.id,
  }

  if (response.usage) {
    result.usageMetadata = transformUsageMetadata(response.usage)
  }

  return result
}

// =============================================================================
// Parse Helpers (Gemini → Unified)
// =============================================================================

function parseContentPart(part: GeminiPart): ContentPart {
  // Text content
  if (part.text !== undefined) {
    return { type: 'text', text: part.text }
  }

  // Function call
  if (part.functionCall) {
    return {
      type: 'tool_call',
      toolCall: {
        id: part.functionCall.id || generateId(),
        name: part.functionCall.name,
        arguments: part.functionCall.args,
      },
    }
  }

  // Inline data (images)
  if (part.inlineData) {
    return {
      type: 'image',
      image: {
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      },
    }
  }

  // Fallback
  return { type: 'text', text: '' }
}

function parseThinkingPart(part: GeminiPart): ThinkingBlock {
  return {
    text: part.text ?? '',
    signature: part.thoughtSignature,
  }
}

function parseUsageMetadata(metadata?: GeminiUsageMetadata): UsageInfo | undefined {
  if (!metadata) return undefined

  const result: UsageInfo = {
    inputTokens: metadata.promptTokenCount,
    outputTokens: metadata.candidatesTokenCount,
    totalTokens: metadata.totalTokenCount,
  }

  if (metadata.thoughtsTokenCount !== undefined) {
    result.thinkingTokens = metadata.thoughtsTokenCount
  }

  if (metadata.cachedContentTokenCount !== undefined) {
    result.cachedTokens = metadata.cachedContentTokenCount
  }

  return result
}

function mapFinishReason(finishReason?: GeminiFinishReason, hasFunctionCall?: boolean): StopReason {
  // If there's a function call, it's tool_use regardless of finish reason
  if (hasFunctionCall) {
    return 'tool_use'
  }

  switch (finishReason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter'
    default:
      return null
  }
}

// =============================================================================
// Transform Helpers (Unified → Gemini)
// =============================================================================

function transformContentPart(part: ContentPart): GeminiPart {
  switch (part.type) {
    case 'text':
      return { text: part.text ?? '' }

    case 'tool_call':
      if (part.toolCall) {
        return {
          functionCall: {
            name: part.toolCall.name,
            args: part.toolCall.arguments,
          },
        }
      }
      break

    case 'image':
      if (part.image) {
        return {
          inlineData: {
            mimeType: part.image.mimeType,
            data: part.image.data ?? '',
          },
        }
      }
      break

    case 'thinking':
      if (part.thinking) {
        return {
          thought: true,
          text: part.thinking.text,
          thoughtSignature: part.thinking.signature,
        }
      }
      break
  }

  return { text: '' }
}

function transformUsageMetadata(usage: UsageInfo): GeminiUsageMetadata {
  const result: GeminiUsageMetadata = {
    promptTokenCount: usage.inputTokens,
    candidatesTokenCount: usage.outputTokens,
    totalTokenCount: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  }

  if (usage.thinkingTokens !== undefined) {
    result.thoughtsTokenCount = usage.thinkingTokens
  }

  if (usage.cachedTokens !== undefined) {
    result.cachedContentTokenCount = usage.cachedTokens
  }

  return result
}

function mapStopReason(stopReason: StopReason): GeminiFinishReason | undefined {
  switch (stopReason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'STOP'
    case 'max_tokens':
      return 'MAX_TOKENS'
    case 'content_filter':
      return 'SAFETY'
    case 'error':
      return 'OTHER'
    default:
      return undefined
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `resp_${Math.random().toString(36).slice(2, 11)}`
}

export function extractSignatureFromResponse(response: GeminiResponse): string | null {
  const candidate = response.candidates[0]
  if (!candidate?.content?.parts) return null

  const thinkingPart = candidate.content.parts.find((part) => part.thought === true)
  return thinkingPart?.thoughtSignature ?? null
}
