import type { JsonValue } from '../../types/json-schema.js'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified.js'
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
import { buildGeminiResponse } from './shared/response.js'
import { GeminiStreamingBuilder } from './streaming/gemini-streaming-builder.js'
import { parseGeminiStreamChunk } from './streaming/parser.js'
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

function isNestedContents(req: unknown): boolean {
  if (!isRecord(req)) return false
  return 'request' in req && isRecord(req.request) && 'contents' in req.request
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

  parseStreamChunk(chunk: unknown): StreamChunk | StreamChunk[] | null {
    try {
      let jsonStr = typeof chunk === 'string' ? chunk : ''
      if (jsonStr.startsWith('data: ')) {
        jsonStr = jsonStr.slice(6)
      }

      const raw = jsonStr ? JSON.parse(jsonStr) : chunk
      return parseGeminiStreamChunk(raw)
    } catch {
      return null
    }
  }

  buildStreamChunk(chunk: StreamChunk): string | string[] {
    const builder = new GeminiStreamingBuilder()
    const lines = builder.build(chunk)
    return lines.join('')
  }
}
