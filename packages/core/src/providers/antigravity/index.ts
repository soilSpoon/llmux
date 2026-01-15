/**
 * Antigravity Provider
 *
 * Provider implementation for Antigravity API wrapper format.
 * Antigravity wraps Gemini-style requests/responses with additional metadata.
 */

import crypto from 'node:crypto'
import { buildWireRequest as buildGeminiRequest } from '../../formats/google-gemini/request'
import type { GeminiRequest, GeminiResponse } from '../../formats/google-gemini/types'
import { getFormat } from '../../formats/registry'
import type { UnifiedError } from '../../types/error'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { BaseProvider, type ProviderConfig, type ProviderName } from '../base'
import { ANTIGRAVITY_SYSTEM_INSTRUCTION } from './constants'
import { createAntigravityStreamingPipeline } from './streaming-pipeline'
import {
  createInnerRequest,
  ensureToolConfig,
  extractMetadata,
  injectSystemInstruction,
  normalizeGenerationConfig,
  preprocessTools,
} from './transform-utils'
import { type AntigravityRequest, type AntigravityResponse, isAntigravityRequest } from './types'

export class AntigravityProvider extends BaseProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  constructor(name: ProviderName = 'antigravity') {
    super()
    this.name = name
    this.config = {
      name,
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      defaultStreamParser: 'sse-line-delimited',
    }
  }

  isSupportedRequest(request: unknown): boolean {
    if (isAntigravityRequest(request)) return true

    // Legacy/Alternative detection (from old detectFormat)
    // Supports { payload: { contents: ... } } structure
    if (request && typeof request === 'object' && 'payload' in request) {
      const payload = (request as Record<string, unknown>).payload
      if (payload && typeof payload === 'object' && 'contents' in payload) {
        return true
      }
    }

    // Detect raw SSE stream accumulation attempts (candidates array)
    // This allows AntigravityProvider to handle raw Gemini format chunks during accumulation
    if (
      request &&
      typeof request === 'object' &&
      'candidates' in request &&
      Array.isArray((request as Record<string, unknown>).candidates)
    ) {
      return true
    }

    return false
  }

  readonly createStreamingPipeline = (model: string): import('../../types').StreamingPipeline =>
    createAntigravityStreamingPipeline(model)

  /**
   * Parse an Antigravity/Gemini SSE streaming chunk.
   */
  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    const pipeline = this.createStreamingPipeline(this.name)
    return pipeline.parse(chunk)
  }

  /**
   * Parse an Antigravity request into UnifiedRequest format.
   * Handles both wrapped ({ request: { contents: ... } }) and unwrapped formats.
   */
  parse(request: unknown): UnifiedRequest {
    // Unwrap Antigravity envelope if present
    let geminiRequest: Record<string, unknown>
    let project: string | undefined
    let model: string | undefined

    let userRole: string | undefined

    if (isAntigravityRequest(request)) {
      geminiRequest = request.request as unknown as Record<string, unknown>
      project = request.project
      model = request.model
      userRole = request.userRole
    } else {
      // Fallback or unwrapped
      geminiRequest = request as Record<string, unknown>
    }

    // Antigravity's inner request is exactly GeminiRequest
    const unified = getFormat('google-gemini').parseRequest(
      geminiRequest as unknown as GeminiRequest
    )

    if (userRole) {
      unified.userRole = userRole
    }

    // Extract non-standard fields from geminiRequest into metadata
    const standardGeminiFields = [
      'contents',
      'systemInstruction',
      'generationConfig',
      'tools',
      'toolConfig',
      'safetySettings',
      'cachedContent',
    ]
    const metadata: Record<string, unknown> = { ...unified.metadata }

    if (project) metadata.project = project
    if (model) metadata.model = model

    for (const key of Object.keys(geminiRequest)) {
      if (!standardGeminiFields.includes(key)) {
        metadata[key] = geminiRequest[key]
      }
    }

    unified.metadata = metadata
    return unified
  }

  /**
   * Transform a UnifiedRequest into Antigravity request format.
   * Wraps the Gemini-style request with Antigravity envelope.
   */
  transform(request: UnifiedRequest, model: string): AntigravityRequest {
    const tools = preprocessTools(request.tools)
    const geminiRequest = buildGeminiRequest(
      { ...request, tools },
      {
        provider: this.name,
        model,
      }
    )

    const sessionId = request.metadata?.sessionId || `session-${crypto.randomUUID()}`

    const innerRequest = createInnerRequest(geminiRequest, sessionId)

    injectSystemInstruction(innerRequest, ANTIGRAVITY_SYSTEM_INSTRUCTION, model)
    ensureToolConfig(innerRequest, model)
    normalizeGenerationConfig(innerRequest, model)

    // metadata is optional in UnifiedRequest, but required fields (if metadata exists) simplify this.
    // Fallback values are used if metadata is missing entirely.
    return {
      project: request.metadata?.project ?? '',
      model,
      requestType: 'agent',
      userAgent: 'antigravity',
      requestId: request.metadata?.requestId ?? `agent-${crypto.randomUUID()}`,
      userRole: request.userRole,
      request: innerRequest,
      metadata: extractMetadata(request.metadata),
    }
  }

  /**
   * Parse an Antigravity response into UnifiedResponse format.
   * Handles both wrapped ({ response: { candidates: ... } }) and unwrapped formats.
   */
  parseResponse(response: unknown): UnifiedResponse {
    // Unwrap Antigravity envelope if present
    let geminiResponse = response
    if (
      response &&
      typeof response === 'object' &&
      'response' in response &&
      (response as Record<string, unknown>).response &&
      typeof (response as Record<string, unknown>).response === 'object'
    ) {
      geminiResponse = (response as Record<string, unknown>).response
    }

    return getFormat('google-gemini').parseResponse(geminiResponse as unknown as GeminiResponse)
  }

  /**
   * Transform a UnifiedResponse into Antigravity response format.
   * Wraps the Gemini-style response with Antigravity envelope.
   */
  transformResponse(response: UnifiedResponse): AntigravityResponse {
    const geminiResponse = getFormat('google-gemini').buildWireResponse(response, {
      provider: 'antigravity',
      model: response.model || 'gemini-2.0-flash',
    }) as GeminiResponse

    return { response: geminiResponse }
  }

  /**
   * Parse a provider error into UnifiedError
   * Handles Antigravity/Gemini error format:
   * { error: { code, message, status, details } }
   */
  parseError(error: unknown): UnifiedError {
    let code: UnifiedError['code'] = 'unknown_error'
    let message = 'An unknown error occurred'
    let status: string | undefined

    if (error && typeof error === 'object') {
      const errObj = error as Record<string, unknown>
      const inner = (errObj.error || errObj) as Record<string, unknown>

      if (inner.code) {
        // Map HTTP-like codes
        if (inner.code === 400) code = 'invalid_request_error'
        else if (inner.code === 401 || inner.code === 403) code = 'authentication_error'
        else if (inner.code === 404)
          code = 'invalid_request_error' // Map 404 to invalid_request_error as not_found_error is missing
        else if (inner.code === 429) code = 'rate_limit_error'
        else if (inner.code === 500) code = 'server_error'
      }

      if (typeof inner.status === 'string') {
        status = inner.status
        // Map gRPC status codes if present
        if (status === 'INVALID_ARGUMENT') code = 'invalid_request_error'
        else if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED')
          code = 'authentication_error'
        else if (status === 'NOT_FOUND') code = 'invalid_request_error'
        else if (status === 'RESOURCE_EXHAUSTED') code = 'rate_limit_error'
        else if (status === 'INTERNAL') code = 'server_error'
      }

      if (typeof inner.message === 'string') {
        message = inner.message
      }
    } else if (typeof error === 'string') {
      message = error
    } else if (error instanceof Error) {
      message = error.message
    }

    return {
      provider: this.name,
      code,
      message,
      retryable: code === 'rate_limit_error' || code === 'server_error',
      originalError: error,
    }
  }

  /**
   * Get the schema format ID for this provider's models.
   * Antigravity uses the google-gemini format for streaming.
   */
  getFormatForModel(_model: string): 'google-gemini' {
    return 'google-gemini'
  }
}
