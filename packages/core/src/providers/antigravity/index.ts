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

      // Antigravity sends line-delimited SSE format (one data: event per line, not separated by \n\n)
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

    return false
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

    if (isAntigravityRequest(request)) {
      geminiRequest = request.request as unknown as Record<string, unknown>
      project = request.project
      model = request.model
    } else {
      // Fallback or unwrapped
      geminiRequest = request as Record<string, unknown>
    }

    // Antigravity's inner request is exactly GeminiRequest
    const unified = getFormat('google-gemini').parseRequest(
      geminiRequest as unknown as GeminiRequest
    )

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

  transformStreamChunk(chunk: StreamChunk): string {
    const format = getFormat('google-gemini')
    if (!format.buildStreamChunk) return ''

    const result = format.buildStreamChunk(chunk, {
      provider: 'antigravity',
      model: 'gemini-2.0-flash',
    })

    return Array.isArray(result) ? result.join('') : result
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

  /**
   * Parse an Antigravity SSE stream chunk into unified format.
   * Handles Hybrid Streaming:
   * 1. Anthropic-style events (for Claude models): Delegate to anthropic-messages
   * 2. Gemini-style wrapped chunks ({ response: ... }): Unwrap and delegate to google-gemini
   */
  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    try {
      if (!chunk || chunk.trim() === 'data: [DONE]') return null

      const cleaned = chunk.replace(/^data:\s*/, '').trim()
      if (!cleaned) return null
      const parsed = JSON.parse(cleaned)

      // 1. Detect Anthropic-style SSE event (chunk comes as "event: ... \n data: ...")
      if (
        parsed.type &&
        (parsed.type === 'message_start' ||
          parsed.type === 'content_block_start' ||
          parsed.type === 'content_block_delta' ||
          parsed.type === 'content_block_stop' ||
          parsed.type === 'message_delta' ||
          parsed.type === 'message_stop' ||
          parsed.type === 'ping')
      ) {
        switch (parsed.type) {
          case 'message_start':
            return {
              type: 'usage',
              usage: {
                inputTokens: parsed.message.usage.input_tokens,
                outputTokens: parsed.message.usage.output_tokens,
              },
            }
          case 'content_block_start':
            if (parsed.content_block.type === 'tool_use') {
              return {
                type: 'tool-call-start',
                toolCall: {
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                },
                blockIndex: parsed.index,
              }
            } else if (parsed.content_block.type === 'thinking') {
              return {
                type: 'thinking-start',
                blockIndex: parsed.index,
              }
            }
            return null
          case 'content_block_delta':
            if (parsed.delta.type === 'text_delta') {
              return {
                type: 'text-delta',
                delta: { type: 'text', text: parsed.delta.text },
                blockIndex: parsed.index,
              }
            } else if (parsed.delta.type === 'input_json_delta') {
              return {
                type: 'tool-input-delta',
                delta: { partialJson: parsed.delta.partial_json },
                blockIndex: parsed.index,
              }
            } else if (parsed.delta.type === 'thinking_delta') {
              return {
                type: 'thinking-delta',
                delta: {
                  thinking: {
                    text: parsed.delta.thinking,
                    signature: parsed.delta.signature,
                  },
                },
                blockIndex: parsed.index,
              }
            }
            return null
          case 'content_block_stop':
            return {
              type: 'block_stop',
            } as unknown as StreamChunk
          case 'message_delta': {
            const chunks: StreamChunk[] = []
            if (parsed.usage) {
              chunks.push({
                type: 'usage',
                usage: {
                  inputTokens: 0,
                  outputTokens: parsed.usage.output_tokens,
                },
              })
            }
            if (parsed.delta?.stop_reason) {
              chunks.push({
                type: 'finish',
                finishReason: { unified: parsed.delta.stop_reason, raw: parsed.delta.stop_reason },
                usage: parsed.usage
                  ? { inputTokens: 0, outputTokens: parsed.usage.output_tokens }
                  : undefined,
              } as unknown as StreamChunk)
            }
            return chunks.length > 0 ? chunks : null
          }
          case 'message_stop':
            return {
              type: 'finish',
              finishReason: { unified: 'end_turn', raw: 'message_stop' },
            } as unknown as StreamChunk
          default:
            return null
        }
      }

      // 2. Check for Antigravity/Gemini format
      let geminiChunk = parsed
      if (parsed.response && typeof parsed.response === 'object') {
        geminiChunk = parsed.response
      }

      // If it looks like Gemini candidates
      if (geminiChunk.candidates && Array.isArray(geminiChunk.candidates)) {
        const candidate = geminiChunk.candidates[0]
        if (!candidate) return null

        const chunks: StreamChunk[] = []
        const content = candidate.content
        if (content?.parts) {
          for (const part of content.parts) {
            if (part.text !== undefined) {
              // If it's thought, it's thinking delta
              if (part.thought) {
                chunks.push({
                  type: 'thinking-delta',
                  delta: {
                    thinking: {
                      text: part.text,
                      signature: part.thoughtSignature || part.thought_signature,
                    },
                  },
                })
              } else {
                chunks.push({
                  type: 'text-delta',
                  delta: { type: 'text', text: part.text },
                })
              }
            } else if (part.functionCall) {
              chunks.push({
                type: 'tool-call-start',
                toolCall: {
                  id: part.functionCall.id || `call_${crypto.randomUUID()}`,
                  name: part.functionCall.name,
                },
              })
              const argsStr =
                typeof part.functionCall.args === 'string'
                  ? part.functionCall.args
                  : JSON.stringify(part.functionCall.args)
              chunks.push({
                type: 'tool-input-delta',
                delta: { partialJson: argsStr },
              })
              chunks.push({ type: 'tool-call-end' })
            }
          }
        }

        if (candidate.finishReason) {
          chunks.push({
            type: 'finish',
            finishReason: { unified: 'end_turn', raw: candidate.finishReason },
            skipStopDelta: true,
          } as unknown as StreamChunk)
        }

        if (geminiChunk.usageMetadata) {
          chunks.push({
            type: 'usage',
            usage: {
              inputTokens: geminiChunk.usageMetadata.promptTokenCount,
              outputTokens: geminiChunk.usageMetadata.candidatesTokenCount,
              totalTokens: geminiChunk.usageMetadata.totalTokenCount,
            },
          })
        }

        return chunks.length > 0 ? chunks : null
      }

      // If neither, return null (ignore)
      return null
    } catch {
      // JSON parse error or logic error -> ignore chunk
      return null
    }
  }
}
