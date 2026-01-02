/**
 * Antigravity Streaming Transformations
 *
 * Handles parsing and transforming streaming chunks for Antigravity format.
 * Antigravity uses SSE format: `data: {"response": {...}}`
 */

import { randomUUID } from 'node:crypto'
import { decodeAntigravityToolName } from '../../schema/reversible-tool-name'
import type { StopReason, StreamChunk, UsageInfo } from '../../types/unified'
import { createLogger } from '../../util/logger'
import type { GeminiFinishReason, GeminiUsageMetadata } from '../gemini/types'

const logger = createLogger({ service: 'antigravity-streaming' })

/**
 * Parse an Antigravity SSE stream chunk into unified StreamChunk format.
 */
export function parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
  // Trim whitespace
  const trimmed = chunk.trim()

  // Handle empty or done signals
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
    return null
  }

  // Extract JSON from SSE data line
  let jsonStr = trimmed
  if (trimmed.startsWith('data:')) {
    // Extract all data lines
    const dataLines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())

    // We try to concatenate first.
    jsonStr = dataLines.join('')

    // If it's still multiple JSON objects like "{...}{...}",
    // we take only the first one here if it doesn't parse as a whole.
  } else if (trimmed.startsWith('{')) {
    // Already JSON
    jsonStr = trimmed
  }

  if (!jsonStr) {
    return null
  }

  // Handle multiple JSON objects concatenated like "{...}{...}"
  // This often happens in Antigravity/Gemini SSE streams where multiple events
  // are packed into one "data:" line or multiple "data:" lines.
  const parseJSON = (str: string): unknown[] => {
    const results: unknown[] = []
    let current = str

    while (current.length > 0) {
      try {
        // Try parsing the whole thing first
        results.push(JSON.parse(current))
        break
      } catch (e) {
        // Find where the first object might end
        // Look for the next '{"response"' or '{"candidates"' if available,
        // but generic '}{' is safer for concatenated JSON objects.
        const nextStart = current.indexOf('}{', 1)
        if (nextStart === -1) {
          throw e // No more objects found, rethrow
        }

        const firstPart = current.slice(0, nextStart + 1)
        try {
          results.push(JSON.parse(firstPart))
          current = current.slice(nextStart + 1)
        } catch (innerE) {
          // If even the first part doesn't parse, try finding the next potential start
          const nextPotential = current.indexOf('{', nextStart + 1)
          if (nextPotential === -1) throw innerE
          current = current.slice(nextPotential)
        }
      }
    }
    return results
  }

  let parsedObjects: unknown[]
  try {
    parsedObjects = parseJSON(jsonStr)
  } catch (e) {
    logger.error(
      {
        error: e instanceof Error ? e.message : String(e),
        jsonLength: jsonStr.length,
        jsonSample: jsonStr.slice(0, 500),
        chunkSample: chunk.slice(0, 200),
        stack: e instanceof Error ? e.stack : undefined,
      },
      'JSON parse error in parseStreamChunk'
    )
    return null
  }

  // If we have multiple objects, we should ideally process all of them.
  // But parseStreamChunk currently returns a single StreamChunk.
  // For now, we take the first one, but if it's a content chunk we might
  // want to merge them if possible.

  const processObject = (parsed: unknown): StreamChunk | null => {
    if (!parsed) return null
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
      // Handle usageMetadata even if no candidates or response field
      const parsedObj = parsed as Record<string, unknown>
      const rawUsageMetadata =
        parsedObj?.usageMetadata ||
        (parsedObj?.response as Record<string, unknown> | undefined)?.usageMetadata
      if (rawUsageMetadata && typeof rawUsageMetadata === 'object') {
        const usageMetadata = rawUsageMetadata as GeminiUsageMetadata
        return {
          type: 'usage',
          usage: parseUsageMetadata(usageMetadata),
        }
      }
      return null
    }

    // Extract candidates
    const candidates = response.candidates as Array<Record<string, unknown>> | undefined
    if (!candidates || candidates.length === 0) {
      // Handle cases where usage is present but no candidates
      const usageMetadata = response.usageMetadata as GeminiUsageMetadata | undefined
      if (usageMetadata) {
        return {
          type: 'usage',
          usage: parseUsageMetadata(usageMetadata),
        }
      }
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

    // Function call chunk - decode tool name
    if (part.functionCall) {
      const fc = part.functionCall as Record<string, unknown>
      logger.trace(
        { fc: JSON.stringify(fc).slice(0, 500) },
        '[DIAG-AG] Raw functionCall from Antigravity'
      )
      const name = decodeAntigravityToolName(fc.name as string)
      let args = fc.args as Record<string, unknown>
      logger.trace(
        { name, args: JSON.stringify(args).slice(0, 300) },
        '[DIAG-AG] Parsed functionCall'
      )

      // Bash compatibility: Copy 'command' to 'cmd' if needed (matching Go implementation)
      if (
        (name.toLowerCase() === 'bash' || name === 'bash_20241022') &&
        args &&
        typeof args === 'object'
      ) {
        if ('command' in args && !('cmd' in args)) {
          args = { ...args, cmd: args.command }
        }
      }

      return {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: (fc.id as string) || `${fc.name}-${randomUUID()}`,
            name: name,
            arguments: args,
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

  // If multiple objects, we should return all of them as separate chunks.
  // We change the return type to StreamChunk | StreamChunk[] | null.
  if (parsedObjects.length > 1) {
    // console.error(`[antigravity parseStreamChunk] Found ${parsedObjects.length} objects`)
    const chunks = parsedObjects.map((obj) => processObject(obj)).filter(Boolean) as StreamChunk[]
    return chunks.length > 0 ? chunks : null
  }

  return processObject(parsedObjects[0])
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
