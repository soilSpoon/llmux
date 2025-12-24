/**
 * Gemini Streaming Transformations
 * Handles SSE parsing and transformation for Gemini streaming API
 */

import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'
import type {
  GeminiFinishReason,
  GeminiPart,
  GeminiStreamChunk,
  GeminiUsageMetadata,
} from './types'

/**
 * Parse SSE stream chunk from Gemini format to unified StreamChunk
 */
export function parseStreamChunk(chunk: string): StreamChunk | null {
  // Handle non-data lines
  if (!chunk.startsWith('data:')) {
    return null
  }

  // Extract JSON data after 'data:' prefix
  const jsonStr = chunk.slice(5).trim()

  // Handle empty data or [DONE] marker
  if (!jsonStr || jsonStr === '[DONE]') {
    return null
  }

  // Parse JSON
  let data: GeminiStreamChunk
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return null
  }

  // Validate structure
  if (!data.candidates?.length) {
    return null
  }

  const candidate = data.candidates[0]
  if (!candidate?.content) {
    // Handle done chunk (finishReason but no content)
    if (candidate?.finishReason) {
      return parseDoneChunk(candidate.finishReason, data.usageMetadata)
    }
    return null
  }

  const parts = candidate.content.parts ?? []

  // Check for thinking parts
  const thinkingPart = parts.find((p) => p.thought === true)
  if (thinkingPart) {
    return parseThinkingChunk(thinkingPart, candidate.finishReason, data.usageMetadata)
  }

  // Check for function call
  const functionCallPart = parts.find((p) => p.functionCall)
  if (functionCallPart) {
    return parseFunctionCallChunk(functionCallPart, candidate.finishReason, data.usageMetadata)
  }

  // Check for text content
  const textParts = parts.filter((p) => p.text !== undefined && !p.thought)
  if (textParts.length > 0) {
    return parseTextChunk(textParts, candidate.finishReason, data.usageMetadata)
  }

  // Handle done chunk (finishReason but no content)
  if (candidate.finishReason) {
    return parseDoneChunk(candidate.finishReason, data.usageMetadata)
  }

  return null
}

/**
 * Transform unified StreamChunk to Gemini SSE format
 */
export function transformStreamChunk(chunk: StreamChunk): string {
  const geminiChunk = transformToGeminiChunk(chunk)
  return `data: ${JSON.stringify(geminiChunk)}`
}

// =============================================================================
// Parse Helpers
// =============================================================================

function parseTextChunk(
  textParts: GeminiPart[],
  finishReason?: GeminiFinishReason,
  usageMetadata?: GeminiUsageMetadata
): StreamChunk {
  // Concatenate all text parts
  const text = textParts.map((p) => p.text ?? '').join('')

  const result: StreamChunk = {
    type: 'content',
    delta: { type: 'text', text },
  }

  if (finishReason) {
    result.stopReason = mapFinishReason(finishReason, false)
  }

  if (usageMetadata) {
    result.usage = mapUsageMetadata(usageMetadata)
  }

  return result
}

function parseFunctionCallChunk(
  part: GeminiPart,
  _finishReason?: GeminiFinishReason,
  usageMetadata?: GeminiUsageMetadata
): StreamChunk {
  const result: StreamChunk = {
    type: 'tool_call',
    delta: {
      type: 'tool_call',
      toolCall: {
        id: part.functionCall!.id || generateId(),
        name: part.functionCall!.name,
        arguments: part.functionCall!.args,
      },
    },
  }

  // Function calls always indicate tool_use
  result.stopReason = 'tool_use'

  if (usageMetadata) {
    result.usage = mapUsageMetadata(usageMetadata)
  }

  return result
}

function parseThinkingChunk(
  part: GeminiPart,
  finishReason?: GeminiFinishReason,
  usageMetadata?: GeminiUsageMetadata
): StreamChunk {
  const result: StreamChunk = {
    type: 'thinking',
    delta: {
      type: 'thinking',
      thinking: {
        text: part.text ?? '',
        signature: part.thoughtSignature,
      },
    },
  }

  if (finishReason) {
    result.stopReason = mapFinishReason(finishReason, false)
  }

  if (usageMetadata) {
    result.usage = mapUsageMetadata(usageMetadata)
  }

  return result
}

function parseDoneChunk(
  finishReason: GeminiFinishReason,
  usageMetadata?: GeminiUsageMetadata
): StreamChunk {
  const result: StreamChunk = {
    type: 'done',
    stopReason: mapFinishReason(finishReason, false),
  }

  if (usageMetadata) {
    result.usage = mapUsageMetadata(usageMetadata)
  }

  return result
}

function mapFinishReason(finishReason: GeminiFinishReason, hasFunctionCall: boolean): StopReason {
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

function mapUsageMetadata(metadata: GeminiUsageMetadata): UsageInfo {
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

// =============================================================================
// Transform Helpers
// =============================================================================

function transformToGeminiChunk(chunk: StreamChunk): GeminiStreamChunk | { error: string } {
  switch (chunk.type) {
    case 'content':
      return transformContentChunk(chunk)

    case 'tool_call':
      return transformToolCallChunk(chunk)

    case 'thinking':
      return transformThinkingChunk(chunk)

    case 'done':
      return transformDoneChunk(chunk)

    case 'usage':
      return transformUsageChunk(chunk)

    case 'error':
      return { error: chunk.error ?? 'Unknown error' }

    default:
      return {
        candidates: [
          {
            content: { role: 'model', parts: [] },
          },
        ],
      }
  }
}

function transformContentChunk(chunk: StreamChunk): GeminiStreamChunk {
  const parts: GeminiPart[] = []

  if (chunk.delta?.text !== undefined) {
    parts.push({ text: chunk.delta.text })
  }

  const result: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: chunk.stopReason ? mapStopReasonToFinish(chunk.stopReason) : undefined,
      },
    ],
  }

  if (chunk.usage) {
    result.usageMetadata = transformUsage(chunk.usage)
  }

  return result
}

function transformToolCallChunk(chunk: StreamChunk): GeminiStreamChunk {
  const parts: GeminiPart[] = []

  if (chunk.delta?.toolCall) {
    parts.push({
      functionCall: {
        name: chunk.delta.toolCall.name,
        args: chunk.delta.toolCall.arguments,
      },
    })
  }

  const result: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: 'STOP',
      },
    ],
  }

  if (chunk.usage) {
    result.usageMetadata = transformUsage(chunk.usage)
  }

  return result
}

function transformThinkingChunk(chunk: StreamChunk): GeminiStreamChunk {
  const parts: GeminiPart[] = []

  if (chunk.delta?.thinking) {
    parts.push({
      thought: true,
      text: chunk.delta.thinking.text,
      thoughtSignature: chunk.delta.thinking.signature,
    })
  }

  const result: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: chunk.stopReason ? mapStopReasonToFinish(chunk.stopReason) : undefined,
      },
    ],
  }

  if (chunk.usage) {
    result.usageMetadata = transformUsage(chunk.usage)
  }

  return result
}

function transformDoneChunk(chunk: StreamChunk): GeminiStreamChunk {
  const result: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: 'model', parts: [] },
        finishReason: chunk.stopReason ? mapStopReasonToFinish(chunk.stopReason) : 'STOP',
      },
    ],
  }

  if (chunk.usage) {
    result.usageMetadata = transformUsage(chunk.usage)
  }

  return result
}

function transformUsageChunk(chunk: StreamChunk): GeminiStreamChunk {
  const result: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: 'model', parts: [] },
      },
    ],
  }

  if (chunk.usage) {
    result.usageMetadata = transformUsage(chunk.usage)
  }

  return result
}

function mapStopReasonToFinish(stopReason: StopReason): GeminiFinishReason {
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

function transformUsage(usage: UsageInfo): GeminiUsageMetadata {
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

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `call_${Math.random().toString(36).slice(2, 11)}`
}
