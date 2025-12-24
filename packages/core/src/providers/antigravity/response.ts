/**
 * Antigravity Response Transformations
 *
 * Handles bidirectional transformation between UnifiedResponse and AntigravityResponse.
 * Antigravity wraps Gemini-style responses with additional metadata.
 */

import { randomUUID } from 'crypto'
import type {
  ContentPart,
  StopReason,
  ThinkingBlock,
  UnifiedResponse,
  UsageInfo,
} from '../../types/unified'
import type { GeminiFinishReason, GeminiPart, GeminiUsageMetadata } from '../gemini/types'
import type { AntigravityResponse } from './types'
import { isAntigravityResponse } from './types'

/**
 * Parse an Antigravity response into UnifiedResponse format.
 * Unwraps the Antigravity envelope and parses the inner Gemini-style response.
 */
export function parseResponse(response: unknown): UnifiedResponse {
  if (!isAntigravityResponse(response)) {
    throw new Error('Invalid Antigravity response: missing response wrapper with candidates')
  }

  const { response: innerResponse } = response
  const { candidates, usageMetadata, responseId } = innerResponse

  // Handle empty candidates
  if (!candidates || candidates.length === 0) {
    return {
      id: responseId || `resp-${randomUUID()}`,
      content: [],
      stopReason: null,
    }
  }

  const candidate = candidates[0]!
  const { content, finishReason } = candidate

  // Separate thinking blocks from content
  const thinkingBlocks: ThinkingBlock[] = []
  const contentParts: ContentPart[] = []
  let hasToolCall = false

  for (const part of content.parts) {
    if (part.thought && part.text !== undefined) {
      // Thinking block
      thinkingBlocks.push({
        text: part.text,
        signature: part.thoughtSignature,
      })
    } else if (part.functionCall) {
      // Function call
      hasToolCall = true
      contentParts.push({
        type: 'tool_call',
        toolCall: {
          id: part.functionCall.id || `${part.functionCall.name}-${randomUUID()}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        },
      })
    } else if (part.text !== undefined) {
      // Text content
      contentParts.push({
        type: 'text',
        text: part.text,
      })
    }
  }

  // Map finish reason
  let stopReason = mapFinishReasonToStopReason(finishReason)

  // Override stop reason if there are tool calls
  if (hasToolCall) {
    stopReason = 'tool_use'
  }

  // Parse usage
  const usage = usageMetadata ? parseUsageMetadata(usageMetadata) : undefined

  return {
    id: responseId || `resp-${randomUUID()}`,
    content: contentParts,
    stopReason,
    usage,
    thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
  }
}

/**
 * Transform a UnifiedResponse into Antigravity response format.
 * Wraps the Gemini-style response in an Antigravity envelope.
 */
export function transformResponse(response: UnifiedResponse): AntigravityResponse {
  const { id, content, stopReason, usage, thinking } = response

  // Build parts array - thinking blocks come first
  const parts: GeminiPart[] = []

  // Add thinking blocks first
  if (thinking) {
    for (const block of thinking) {
      parts.push({
        thought: true,
        text: block.text,
        thoughtSignature: block.signature,
      })
    }
  }

  // Add content parts
  for (const part of content) {
    switch (part.type) {
      case 'text':
        parts.push({ text: part.text || '' })
        break

      case 'tool_call':
        parts.push({
          functionCall: {
            name: part.toolCall!.name,
            args: part.toolCall!.arguments,
            id: part.toolCall!.id,
          },
          // Add thoughtSignature for Claude compatibility
          thoughtSignature: 'skip_thought_signature_validator',
        })
        break

      case 'thinking':
        // Already handled above, but handle inline thinking too
        parts.push({
          thought: true,
          text: part.thinking?.text || '',
          thoughtSignature: part.thinking?.signature,
        })
        break
    }
  }

  // Map stop reason to finish reason
  const finishReason = mapStopReasonToFinishReason(stopReason)

  // Build usage metadata
  const usageMetadata = usage ? transformUsageMetadata(usage) : undefined

  return {
    response: {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason,
        },
      ],
      usageMetadata,
      responseId: id,
    },
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map Gemini finish reason to unified stop reason
 */
function mapFinishReasonToStopReason(finishReason?: GeminiFinishReason): StopReason {
  if (!finishReason) return null

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
    case 'RECITATION':
      return 'error'
    default:
      return null
  }
}

/**
 * Map unified stop reason to Gemini finish reason
 */
function mapStopReasonToFinishReason(stopReason: StopReason): GeminiFinishReason {
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
      return 'STOP'
  }
}

/**
 * Parse Gemini usage metadata to unified format
 */
function parseUsageMetadata(metadata: GeminiUsageMetadata): UsageInfo {
  return {
    inputTokens: metadata.promptTokenCount,
    outputTokens: metadata.candidatesTokenCount,
    totalTokens: metadata.totalTokenCount,
    thinkingTokens: metadata.thoughtsTokenCount,
    cachedTokens: metadata.cachedContentTokenCount,
  }
}

/**
 * Transform unified usage to Gemini format
 */
function transformUsageMetadata(usage: UsageInfo): GeminiUsageMetadata {
  const result: GeminiUsageMetadata = {
    promptTokenCount: usage.inputTokens,
    candidatesTokenCount: usage.outputTokens,
    totalTokenCount: usage.totalTokens || usage.inputTokens + usage.outputTokens,
  }

  if (usage.thinkingTokens) {
    result.thoughtsTokenCount = usage.thinkingTokens
  }

  if (usage.cachedTokens) {
    result.cachedContentTokenCount = usage.cachedTokens
  }

  return result
}
