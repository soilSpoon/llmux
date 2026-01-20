import type { JsonValue } from '../../types/json-schema.js'
import type {
  StopReason,
  StreamChunk,
  UnifiedRequest,
  UnifiedResponse,
} from '../../types/unified.js'
import { ToolNameCodec } from '../../util/tool-name-codec.js'
import { isJsonValue, isRecord } from '../../util/type-guards.js'
import type { FormatContext, FormatId, SchemaFormat } from '../base.js'
import { getAntigravityHeaders } from './antigravity/headers.js'
import { buildAntigravityRequest, parseAntigravityRequest } from './antigravity/request.js'
import { parseAntigravityResponse } from './antigravity/response.js'
import type { AntigravityProviderRequest } from './antigravity/types.js'
import {
  isAntigravityClientRequest,
  isAntigravityProviderRequest,
  isAntigravityResponse,
} from './antigravity/types.js'
import { resolveGeminiFamilyCapabilities } from './capabilities.js'
import { getGeminiCliHeaders } from './gemini-cli/headers.js'
import { buildGeminiCliRequest } from './gemini-cli/request.js'
import type { GeminiCliRequest } from './gemini-cli/types.js'
import { buildGeminiResponse, type GeminiResponse } from './shared/response.js'
import { GeminiStreamingBuilder } from './streaming/gemini-streaming-builder.js'
import { StreamingStateMachine } from './streaming/state-machine.js'

function sanitizeMetadata(meta: UnifiedRequest['metadata']): Record<string, JsonValue> | undefined {
  if (!meta) return undefined
  const result: Record<string, JsonValue> = {}
  for (const [key, val] of Object.entries(meta)) {
    if (val !== undefined && isJsonValue(val)) {
      result[key] = val
    }
  }
  return result
}

function isGeminiCliRequest(request: unknown): request is GeminiCliRequest {
  if (!request || typeof request !== 'object') return false
  const req = request as GeminiCliRequest
  // Check for contents array and absence of envelope fields
  return (
    Array.isArray(req.contents) &&
    !('project' in req) &&
    !('request' in req) &&
    !isNestedContents(req)
  )
}

function isGeminiResponse(val: unknown): val is GeminiResponse {
  return isRecord(val) && Array.isArray(val.candidates)
}

function isNestedContents(req: unknown): boolean {
  if (!isRecord(req)) return false
  return 'request' in req && isRecord(req.request) && 'contents' in req.request
}

function mapFinishReason(reason?: string): StopReason {
  if (!reason) return null
  switch (reason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter'
    default:
      return null
  }
}

/**
 * Phase 6: Gemini Format Hub (Hub-and-Spoke Architecture)
 * Routes requests to specific adapters (Antigravity or Gemini-CLI) based on model capabilities.
 */

export class GeminiFormat implements SchemaFormat {
  readonly id: FormatId = 'google-gemini'

  isSupportedWireRequest(request: unknown): boolean {
    return (
      isAntigravityProviderRequest(request) ||
      isAntigravityClientRequest(request) ||
      isGeminiCliRequest(request)
    )
  }

  isSupportedWireResponse(response: unknown): boolean {
    return isAntigravityResponse(response)
  }

  parseRequest(request: unknown): UnifiedRequest {
    if (isAntigravityProviderRequest(request)) {
      return parseAntigravityRequest(request)
    }
    if (isAntigravityClientRequest(request)) {
      return parseAntigravityRequest(request)
    }
    if (isGeminiCliRequest(request)) {
      // Treat CLI request as ProviderRequestPayload for parsing purpose
      return parseAntigravityRequest({
        project: 'unknown',
        model: 'unknown',
        request,
      } as unknown)
    }
    throw new Error('Unsupported Gemini request format')
  }

  buildWireRequest(
    request: UnifiedRequest,
    ctx: FormatContext
  ): AntigravityProviderRequest | GeminiCliRequest {
    const caps = resolveGeminiFamilyCapabilities(ctx.model)

    // Force Antigravity format if provider explicitly requests it
    // This logic is required to support both Antigravity (wrapped) and Gemini CLI (unwrapped) providers
    if (ctx.provider === 'antigravity' || caps.transport === 'antigravity') {
      // Default to Antigravity
      return buildAntigravityRequest(request, {
        model: ctx.model,
        project: request.metadata?.project,
        userAgent: request.metadata?.userAgent || 'antigravity',
        requestId: request.metadata?.requestId,
        location: request.metadata?.location,
        metadata: {
          ...sanitizeMetadata(request.metadata),
          requestType: 'generateContent',
        },
      })
    }

    return buildGeminiCliRequest(request, {
      model: ctx.model,
      project: request.metadata?.project || 'default-project',
      location: request.metadata?.location || 'global',
    })
  }

  // Alias for tests to maintain backward compatibility
  transformRequest(
    req: UnifiedRequest,
    ctx: FormatContext = { model: 'unknown', provider: 'google' }
  ): unknown {
    return this.buildWireRequest(req, ctx)
  }

  // Alias for tests (Unified -> Provider) to maintain backward compatibility
  // Tests invoke this assuming it transforms Provider Response to Unified Response
  transformResponse(response: unknown): UnifiedResponse {
    return this.parseResponse(response)
  }

  parseResponse(response: unknown): UnifiedResponse {
    return parseAntigravityResponse(response)
  }

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return buildGeminiResponse(unified)
  }

  getHeaders(req: UnifiedRequest, accessToken: string): Record<string, string> {
    const modelId = req.metadata?.model || req.model
    if (!modelId) {
      throw new Error('Model identity is required for Gemini header generation')
    }
    const caps = resolveGeminiFamilyCapabilities(modelId)

    if (caps.transport === 'antigravity') {
      return getAntigravityHeaders(accessToken)
    } else {
      return getGeminiCliHeaders(accessToken)
    }
  }

  createStream(): StreamingStateMachine {
    return new StreamingStateMachine()
  }

  parseStreamChunk(chunk: unknown): StreamChunk | null {
    let data: GeminiResponse
    try {
      let jsonStr = typeof chunk === 'string' ? chunk : ''
      if (jsonStr.startsWith('data: ')) {
        jsonStr = jsonStr.slice(6)
      }

      const raw = jsonStr ? JSON.parse(jsonStr) : chunk
      if (!raw || typeof raw !== 'object') return null

      // Check for wrapped Antigravity response
      if (isAntigravityResponse(raw)) {
        data = raw.response
      } else if (isGeminiResponse(raw)) {
        data = raw
      } else {
        return null
      }
    } catch {
      return null
    }

    if (!data || !data.candidates?.[0]) return null

    const candidate = data.candidates[0]
    const part = candidate.content?.parts?.[0]

    // Usage
    if (data.usageMetadata) {
      return {
        type: 'usage',
        usage: {
          inputTokens: data.usageMetadata.promptTokenCount || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        },
      }
    }

    // Finish
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      if (!part) {
        return {
          type: 'finish',
          finishReason: {
            unified: mapFinishReason(candidate.finishReason),
            raw: candidate.finishReason,
          },
        }
      }
    }

    // Content
    if (part) {
      if (part.thought && part.text) {
        return {
          type: 'thinking-delta',
          delta: {
            thinking: { text: part.text, signature: part.thoughtSignature },
          },
        }
      }
      if (part.text) {
        return {
          type: 'text-delta',
          delta: { text: part.text },
        }
      }
      if (part.functionCall) {
        const codec = new ToolNameCodec()
        const args = part.functionCall.args
        return {
          type: 'tool_call',
          delta: {
            type: 'tool_call',
            toolCall: {
              id: part.functionCall.id || 'unknown',
              name: codec.decode(part.functionCall.name),
              arguments: typeof args === 'string' ? JSON.parse(args) : args,
            },
          },
        }
      }
    }

    return null
  }

  buildStreamChunk(chunk: StreamChunk): string | string[] {
    const builder = new GeminiStreamingBuilder()
    const lines = builder.build(chunk)
    return lines.join('')
  }
}
