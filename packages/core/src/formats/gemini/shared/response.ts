import type { JsonObject, JsonValue } from '../../../types/json-schema.js'
import type {
  ContentPart,
  StopReason,
  ThinkingBlock,
  UnifiedResponse,
} from '../../../types/unified.js'
import { ToolNameCodec } from '../../../util/tool-name-codec.js'

/**
 * Shared Response Parser for Gemini (Standard Format)
 * Used by both Antigravity and Gemini-CLI adapters.
 */

const codec = new ToolNameCodec()

export interface GeminiFunctionCall extends JsonObject {
  id?: string
  name: string
  args: JsonObject | string
}

export interface GeminiFunctionResponseBody extends JsonObject {
  content: JsonObject
}

export interface GeminiFunctionResponse extends JsonObject {
  id?: string
  name: string
  response: GeminiFunctionResponseBody
}

export interface GeminiPart extends JsonObject {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
  thought?: boolean
  thoughtSignature?: string
  thought_signature?: string
  type?: string
}

export interface GeminiContent extends JsonObject {
  parts?: GeminiPart[]
  role?: string
}

export interface GeminiCandidate extends JsonObject {
  content?: GeminiContent
  finishReason?: string
  index?: number
  citationMetadata?: JsonValue
  safetyRatings?: JsonValue
}

export interface GeminiTokenDetails extends JsonObject {
  modality: string
  tokenCount: number
}

export interface GeminiUsageMetadata extends JsonObject {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
  trafficType?: string
  promptTokensDetails?: GeminiTokenDetails[]
  candidatesTokensDetails?: GeminiTokenDetails[]
  [key: string]: JsonValue | undefined
}

export interface GeminiResponse extends JsonObject {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string; [key: string]: JsonValue | undefined }
  usageMetadata?: GeminiUsageMetadata
  modelVersion?: string
  responseId?: string
  trafficType?: string // Also at top level in some versions
}

export function parseGeminiResponse(response: GeminiResponse): UnifiedResponse {
  const candidate = response.candidates?.[0]
  if (!candidate) {
    if (response.promptFeedback?.blockReason) {
      return {
        id: `resp_${Math.random().toString(36).slice(2)}`,
        content: [{ type: 'text', text: `Blocked: ${response.promptFeedback.blockReason}` }],
        model: 'unknown',
        usage: mapUsage(response.usageMetadata),
        stopReason: 'content_filter',
      }
    }
    throw new Error('No candidates in Gemini response')
  }

  const content: ContentPart[] = []
  const thinking: ThinkingBlock[] = []

  if (candidate.content?.parts) {
    for (const part of candidate.content.parts) {
      const signature = part.thoughtSignature || part.thought_signature

      if (part.thought) {
        // Handle thinking block
        thinking.push({
          text: part.text || '',
          signature,
        })
      } else {
        // Handle regular content (text or tool call)
        if (part.text !== undefined) {
          content.push({
            type: 'text',
            text: part.text,
            thoughtSignature: signature,
          })
        }
        if (part.functionCall) {
          content.push({
            type: 'tool_call',
            toolCall: {
              id: `call_${Math.random().toString(36).slice(2)}`,
              name: codec.decode(part.functionCall.name), // Should be prefixed with 't' or 'h'
              arguments: part.functionCall.args,
            },
            thoughtSignature: signature,
          })
        }
      }
    }
  }

  const hasToolCall = content.some((p) => p.type === 'tool_call')

  return {
    id: `resp_${Math.random().toString(36).slice(2)}`,
    content,
    thinking: thinking.length > 0 ? thinking : undefined,
    model: 'unknown',
    usage: mapUsage(response.usageMetadata),
    stopReason: hasToolCall ? 'tool_use' : mapStopReason(candidate.finishReason),
    metadata: { raw: response },
  }
}

export function buildGeminiResponse(unified: UnifiedResponse): GeminiResponse {
  // Convert UnifiedResponse back to GeminiResponse (for round-trip testing)
  const candidates: GeminiCandidate[] = []

  const contentParts: GeminiPart[] = []
  if (unified.content) {
    for (const part of unified.content) {
      if (part.type === 'text' && part.text) {
        contentParts.push({ text: part.text })
      } else if (part.type === 'tool_call' && part.toolCall) {
        contentParts.push({
          functionCall: {
            id: part.toolCall.id,
            name: codec.encode(part.toolCall.name),
            args:
              typeof part.toolCall.arguments === 'string'
                ? JSON.parse(part.toolCall.arguments)
                : part.toolCall.arguments,
          },
        })
      }
    }
  }

  candidates.push({
    content: {
      parts: contentParts,
      role: 'model',
    },
    finishReason: mapFinishReason(unified.stopReason),
    index: 0,
  })

  // Restore raw response metadata if available
  const raw = unified.metadata?.raw as GeminiResponse | undefined

  return {
    ...raw, // Preserve original fields
    candidates,
    usageMetadata: unified.usage
      ? {
          promptTokenCount: unified.usage.inputTokens,
          candidatesTokenCount: unified.usage.outputTokens,
          totalTokenCount: unified.usage.totalTokens,
        }
      : raw?.usageMetadata,
    responseId: unified.id,
  }
}

function mapFinishReason(reason: StopReason): string {
  switch (reason) {
    case 'end_turn':
      return 'STOP'
    case 'max_tokens':
      return 'MAX_TOKENS'
    case 'content_filter':
      return 'SAFETY'
    default:
      return 'STOP'
  }
}

function mapUsage(meta?: GeminiUsageMetadata) {
  if (!meta) return undefined
  return {
    inputTokens: meta.promptTokenCount || 0,
    outputTokens: meta.candidatesTokenCount || 0,
    totalTokens: meta.totalTokenCount || 0,
  }
}

export function mapStopReason(reason?: string): StopReason {
  switch (reason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter'
    default:
      return 'end_turn'
  }
}
