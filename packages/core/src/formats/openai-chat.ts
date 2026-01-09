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
} from '../types/unified'
import type { FormatContext, SchemaFormat } from './base'
import { isOpenAIChatRequest, parseRequest, transformRequest } from './openai-chat/index'
import { parseResponse, transformResponse } from './openai-chat/response'
import {
  parseStreamChunk as parseOpenAIChatStreamChunk,
  transformStreamChunk as transformOpenAIChatStreamChunk,
} from './openai-chat/streaming'
import { createOpenAIChatStreamingPipeline } from './openai-chat/streaming-pipeline'
import { isOpenAIChatResponse } from './openai-chat/types'

/**
 * Detect if a request is for OpenAI Chat Completions API (vs Responses API).
 * A request is for Chat Completions if it has 'messages' but not Responses API indicators.
 */
function isChatCompletionsRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false
  const req = request as Record<string, unknown>

  // Responses API indicators
  const responsesApiFields = [
    'input',
    'instructions',
    'max_output_tokens',
    'previous_response_id',
    'reasoning',
    'truncation',
    'store',
  ]

  // Check for Responses API indicators first
  if ('input' in req && !('messages' in req)) {
    return false
  }
  if ('input' in req) {
    return false
  }

  for (const field of responsesApiFields) {
    if (field in req) {
      return false
    }
  }

  // Default to Chat Completions
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
    // Use local parsing logic from formats/openai-chat/request.ts
    return parseRequest(req as Parameters<typeof parseRequest>[0])
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    // Use local transformation logic from formats/openai-chat/request.ts
    return transformRequest(unified, ctx.model)
  },

  parseResponse(res: unknown): UnifiedResponse {
    // Use local parsing logic from formats/openai-chat/response.ts
    return parseResponse(res as Parameters<typeof parseResponse>[0])
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    // Use local transformation logic from formats/openai-chat/response.ts
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
