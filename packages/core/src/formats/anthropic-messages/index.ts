import type {
  StreamChunk,
  StreamingPipeline,
  UnifiedRequest,
  UnifiedResponse,
} from '../../types/unified'
import type { FormatContext, SchemaFormat } from '../base'
import { parseRequest, transformRequest } from './request'
import { parseResponse, transformResponse } from './response'
import { parseStreamChunk, transformStreamChunk } from './streaming'
import { createAnthropicStreamingPipeline } from './streaming-pipeline'
import { isAnthropicRequest, isAnthropicResponse } from './types'

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
