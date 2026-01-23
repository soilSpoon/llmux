/**
 * OpenAI Chat Format
 *
 * SchemaFormat implementation for OpenAI Chat Completions API.
 * This format is self-contained with no dependencies on providers/ layer.
 */

import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../../types/unified'
import type { FormatContext, SchemaFormat } from '../base'
import { parseRequest, transformRequest } from './request'
import { parseResponse, transformResponse } from './response'
import {
  parseStreamChunk as parseOpenAIChatStreamChunk,
  transformStreamChunk as transformOpenAIChatStreamChunk,
} from './streaming'
import { createOpenAIChatStreamingPipeline } from './streaming-pipeline'
import { isOpenAIChatRequest, isOpenAIChatResponse } from './types'

// Re-exports
export { OpenAIChatStreamingBuilder } from './openai-streaming-builder'
export { parseRequest, transformRequest } from './request'
export { parseResponse, transformResponse } from './response'
export { parseStreamChunk, transformStreamChunk } from './streaming'
export * from './types'

/**
 * Detect if a request is for OpenAI Chat Completions API (vs Responses API).
 */
function isChatCompletionsRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false
  const req = request as Record<string, unknown>

  const responsesApiFields = [
    'input',
    'instructions',
    'max_output_tokens',
    'previous_response_id',
    'reasoning',
    'truncation',
    'store',
  ]

  if ('input' in req) return false

  for (const field of responsesApiFields) {
    if (field in req) return false
  }

  return true
}

export const OpenAIChatFormat: SchemaFormat = {
  id: 'openai-chat',

  isSupportedWireRequest(req: unknown): boolean {
    return isOpenAIChatRequest(req) && isChatCompletionsRequest(req)
  },

  isSupportedWireResponse(res: unknown): boolean {
    return isOpenAIChatResponse(res)
  },

  parseRequest(req: unknown): UnifiedRequest {
    return parseRequest(req as Parameters<typeof parseRequest>[0])
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    return transformRequest(unified, ctx.model, ctx.provider)
  },

  parseResponse(res: unknown): UnifiedResponse {
    return parseResponse(res as Parameters<typeof parseResponse>[0])
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseOpenAIChatStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformOpenAIChatStreamChunk(chunk)
  },

  getStreamingPipeline(_ctx: FormatContext): StreamingPipeline {
    return createOpenAIChatStreamingPipeline()
  },
}
