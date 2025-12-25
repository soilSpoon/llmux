/**
 * Antigravity Streaming Transformations
 *
 * Handles parsing and transforming streaming chunks for Antigravity format.
 * Antigravity uses SSE format: `data: {"response": {...}}`
 */

import { randomUUID } from 'node:crypto'
import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'
import type { GeminiFinishReason, GeminiUsageMetadata } from '../gemini/types'

/**
 * Parse an Antigravity SSE stream chunk into unified StreamChunk format.
 */
export function parseStreamChunk(chunk: string): StreamChunk | null {
  // Trim whitespace
  const trimmed = chunk.trim()

  // Handle empty or done signals
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
    return null
  }

  // Extract JSON from SSE data line
  let jsonStr = trimmed
  if (trimmed.startsWith('data:')) {
    jsonStr = trimmed.slice(5).trim()
  }

  if (!jsonStr) {
    return null
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return null
  }

  // Handle both wrapped and unwrapped formats
  let response: Record<string, unknown>

  if (
    parsed &&
    typeof parsed === 'object' &&
    'response' in parsed &&
    typeof (parsed as Record<string, unknown>).response === 'object'
  ) {
    // Antigravity wrapped format
    response = (parsed as Record<string, unknown>).response as Record<string, unknown>
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    'candidates' in parsed &&
    Array.isArray((parsed as Record<string, unknown>).candidates)
  ) {
    // Raw Gemini format (fallback)
    response = parsed as Record<string, unknown>
  } else {
    return null
  }

  // Extract candidates
  const candidates = response.candidates as Array<Record<string, unknown>> | undefined
  if (!candidates || candidates.length === 0) {
    return null
  }

  const candidate = candidates[0]
  if (!candidate) {
    return null
  }
  const content = candidate.content as Record<string, unknown> | undefined
  const finishReason = candidate.finishReason as GeminiFinishReason | undefined
  const usageMetadata = response.usageMetadata as GeminiUsageMetadata | undefined

  // Handle finish/done chunk
  if (finishReason) {
    const stopReason = mapFinishReasonToStopReason(finishReason)
    const usage = usageMetadata ? parseUsageMetadata(usageMetadata) : undefined

    return {
      type: 'done',
      stopReason,
      usage,
    }
  }

  // Handle content chunks
  if (!content) {
    return null
  }

  const parts = content.parts as Array<Record<string, unknown>> | undefined
  if (!parts || parts.length === 0) {
    return null
  }

  const part = parts[0]
  if (!part) {
    return null
  }

  // Thinking chunk
  if (part.thought === true && typeof part.text === 'string') {
    return {
      type: 'thinking',
      delta: {
        type: 'thinking',
        thinking: {
          text: part.text,
          signature: part.thoughtSignature as string | undefined,
        },
      },
    }
  }

  // Function call chunk
  if (part.functionCall) {
    const fc = part.functionCall as Record<string, unknown>
    return {
      type: 'tool_call',
      delta: {
        type: 'tool_call',
        toolCall: {
          id: (fc.id as string) || `${fc.name}-${randomUUID()}`,
          name: fc.name as string,
          arguments: fc.args as Record<string, unknown>,
        },
      },
    }
  }

  // Text chunk
  if (typeof part.text === 'string') {
    return {
      type: 'content',
      delta: {
        type: 'text',
        text: part.text,
      },
    }
  }

  return null
}

/**
 * Transform a unified StreamChunk into Antigravity SSE format.
 */
export function transformStreamChunk(chunk: StreamChunk): string {
  interface AntigravityCandidate {
    content: {
      role: string
      parts: Array<Record<string, unknown>>
    }
    finishReason?: GeminiFinishReason
  }

  interface AntigravityStreamResponse {
    candidates: AntigravityCandidate[]
    usageMetadata?: GeminiUsageMetadata
  }

  const candidate: AntigravityCandidate = {
    content: {
      role: 'model',
      parts: [],
    },
  }

  const response: AntigravityStreamResponse = {
    candidates: [candidate],
  }

  const partsArray = candidate.content.parts

  switch (chunk.type) {
    case 'content':
      if (chunk.delta?.text) {
        partsArray.push({ text: chunk.delta.text })
      }
      break

    case 'thinking':
      if (chunk.delta?.thinking) {
        const thinkingPart: Record<string, unknown> = {
          thought: true,
          text: chunk.delta.thinking.text,
        }
        if (chunk.delta.thinking.signature) {
          thinkingPart.thoughtSignature = chunk.delta.thinking.signature
        }
        partsArray.push(thinkingPart)
      }
      break

    case 'tool_call':
      if (chunk.delta?.toolCall) {
        partsArray.push({
          functionCall: {
            name: chunk.delta.toolCall.name,
            args: chunk.delta.toolCall.arguments,
            id: chunk.delta.toolCall.id,
          },
        })
      }
      break

    case 'usage':
      if (chunk.usage) {
        response.usageMetadata = transformUsageMetadata(chunk.usage)
      }
      break

    case 'done':
      candidate.finishReason = mapStopReasonToFinishReason(chunk.stopReason)
      if (chunk.usage) {
        response.usageMetadata = transformUsageMetadata(chunk.usage)
      }
      break

    case 'error':
      // For errors, we might just skip or include an empty response
      break
  }

  const wrapped = { response }
  return `data: ${JSON.stringify(wrapped)}\n\n`
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map Gemini finish reason to unified stop reason
 */
function mapFinishReasonToStopReason(finishReason: GeminiFinishReason): StopReason {
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
function mapStopReasonToFinishReason(stopReason?: StopReason): GeminiFinishReason {
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
