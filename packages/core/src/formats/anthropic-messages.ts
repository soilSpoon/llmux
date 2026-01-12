import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../types/unified'
import { parseRequest, transformRequest } from './anthropic-messages/request'
import { parseResponse, transformResponse } from './anthropic-messages/response'
import { parseStreamChunk, transformStreamChunk } from './anthropic-messages/streaming'
import { createAnthropicStreamingPipeline } from './anthropic-messages/streaming-pipeline'
import { isAnthropicRequest, isAnthropicResponse } from './anthropic-messages/types'
import type { FormatContext, SchemaFormat } from './base'

export const AnthropicMessagesFormat: SchemaFormat = {
  id: 'anthropic-messages',

  isSupportedWireRequest(req: unknown): boolean {
    return isAnthropicRequest(req)
  },

  isSupportedWireResponse(res: unknown): boolean {
    return isAnthropicResponse(res)
  },

  parseRequest(req: unknown): UnifiedRequest {
    return parseRequest(req)
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    return transformRequest(unified, ctx.model)
  },

  parseResponse(res: unknown): UnifiedResponse {
    return parseResponse(res)
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformStreamChunk(chunk)
  },

  getStreamingPipeline(ctx: FormatContext): StreamingPipeline {
    return createAnthropicStreamingPipeline(ctx.model)
  },
}
