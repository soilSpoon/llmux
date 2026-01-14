import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../../types/unified'
import type { FormatContext, SchemaFormat } from '../base'
import { parseStreamChunk as parseOpenAIStreamChunk } from '../openai-chat/streaming'
import type { OpenAIChatRequest } from '../openai-chat/types'
import {
  parseRequest as parseResponsesRequest,
  transformRequest as transformToResponsesRequest,
} from './request'
import {
  parseResponse as parseResponsesResponse,
  transformResponse as transformToResponsesResponse,
} from './response'
import {
  parseStreamChunk as parseResponsesStreamChunk,
  transformStreamChunk as transformToResponsesStreamChunk,
} from './streaming'
import { createOpenAIResponsesStreamingPipeline } from './streaming-pipeline'

export {
  parseRequest as parseResponsesRequest,
  transformRequest as transformToResponsesRequest,
} from './request'
export {
  parseResponse as parseResponsesResponse,
  transformResponse as transformToResponsesResponse,
} from './response'
export {
  parseStreamChunk as parseResponsesStreamChunk,
  transformStreamChunk as transformToResponsesStreamChunk,
} from './streaming'
// Re-exports
export { OpenAIResponsesStreamingBuilder } from './streaming-builder'
export { createOpenAIResponsesStreamingPipeline } from './streaming-pipeline'

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
 * Check if a request is for OpenAI Responses API.
 */
function isResponsesApiRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false
  const req = request as Record<string, unknown>

  if ('input' in req) return true

  for (const field of RESPONSES_API_FIELDS) {
    if (field in req) return true
  }

  return false
}

export const OpenAIResponsesFormat: SchemaFormat = {
  id: 'openai-responses',

  isSupportedWireRequest(req: unknown): boolean {
    return isOpenAIRequest(req) && isResponsesApiRequest(req)
  },

  isSupportedWireResponse(res: unknown): boolean {
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
    const responsesResult = parseResponsesStreamChunk(chunk)
    if (responsesResult !== null) {
      return responsesResult
    }
    return parseOpenAIStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformToResponsesStreamChunk(chunk)
  },

  getStreamingPipeline(ctx: FormatContext): StreamingPipeline {
    return createOpenAIResponsesStreamingPipeline(ctx.model)
  },
}
