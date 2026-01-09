import type { FormatContext, SchemaFormat } from './base'

/**
 * Check if value is an OpenAI request (inline, no provider dependency)
 */
function isOpenAIRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.model === 'string' && (Array.isArray(obj.messages) || Array.isArray(obj.input))
}

/**
 * Check if value is an OpenAI response (inline, no provider dependency)
 */
function isOpenAIResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' && obj.object === 'chat.completion' && Array.isArray(obj.choices)
  )
}

/**
 * Fields unique to OpenAI Responses API
 */
const RESPONSES_API_FIELDS = [
  'input',
  'instructions',
  'max_output_tokens',
  'previous_response_id',
  'reasoning',
  'truncation',
  'store',
] as const

/**
 * Check if a request is for OpenAI Responses API (inline, no provider dependency)
 */
function isResponsesApiRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false
  const req = request as Record<string, unknown>

  // 'input' is the primary indicator
  if ('input' in req) return true

  // Check for other Responses API-specific fields
  for (const field of RESPONSES_API_FIELDS) {
    if (field in req) return true
  }

  return false
}

import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../types/unified'
import { parseStreamChunk as parseOpenAIStreamChunk } from './openai-chat/streaming'
import type { OpenAIChatRequest } from './openai-chat/types'
import {
  parseRequest as parseResponsesRequest,
  transformRequest as transformToResponsesRequest,
} from './openai-responses/request'
import {
  parseResponse as parseResponsesResponse,
  transformResponse as transformToResponsesResponse,
} from './openai-responses/response'
import {
  parseStreamChunk as parseResponsesStreamChunk,
  transformStreamChunk as transformToResponsesStreamChunk,
} from './openai-responses/streaming'
import { createOpenAIResponsesStreamingPipeline } from './openai-responses/streaming-pipeline'

export const OpenAIResponsesFormat: SchemaFormat = {
  id: 'openai-responses',

  isSupportedWireRequest(req: unknown): boolean {
    return isOpenAIRequest(req) && isResponsesApiRequest(req)
  },

  isSupportedWireResponse(res: unknown): boolean {
    // OpenAI Responses API uses same response format as Chat Completions
    return isOpenAIResponse(res)
  },

  parseRequest(req: unknown): UnifiedRequest {
    return parseResponsesRequest(req as OpenAIChatRequest)
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    return transformToResponsesRequest(unified, ctx.model)
  },

  parseResponse(res: unknown): UnifiedResponse {
    return parseResponsesResponse(res)
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformToResponsesResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    // Try Responses API format first (with event: lines)
    const responsesResult = parseResponsesStreamChunk(chunk)
    if (responsesResult !== null) {
      return responsesResult
    }

    // Fall back to Chat Completions format (for backwards compatibility)
    // This handles standard OpenAI streaming format
    return parseOpenAIStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    // Clients requesting /v1/responses expect Responses API SSE format.
    // Convert Unified StreamChunk back to Responses API format for the response.
    return transformToResponsesStreamChunk(chunk)
  },

  getStreamingPipeline(ctx: FormatContext): StreamingPipeline {
    return createOpenAIResponsesStreamingPipeline(ctx.model)
  },
}
