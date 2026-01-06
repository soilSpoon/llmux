import { isChatCompletionsRequest } from '../providers/openai/format-detector'
import {
  parse as parseChatRequest,
  transform as transformToChatRequest,
} from '../providers/openai/request'
import {
  parseResponse as parseChatResponse,
  transformResponse as transformToChatResponse,
} from '../providers/openai/response'
import {
  parseStreamChunk as parseChatStreamChunk,
  transformStreamChunk as transformToChatStreamChunk,
} from '../providers/openai/streaming'
import { isOpenAIRequest, isOpenAIResponse } from '../providers/openai/types'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'
import type { FormatContext, SchemaFormat } from './base'

export const OpenAIChatFormat: SchemaFormat = {
  id: 'openai-chat',

  isSupportedWireRequest(req: unknown): boolean {
    return isOpenAIRequest(req) && isChatCompletionsRequest(req)
  },

  isSupportedWireResponse(res: unknown): boolean {
    return isOpenAIResponse(res)
  },

  parseRequest(req: unknown): UnifiedRequest {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseChatRequest(req as any)
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    return transformToChatRequest(unified, ctx.model)
  },

  parseResponse(res: unknown): UnifiedResponse {
    return parseChatResponse(res as Parameters<typeof parseChatResponse>[0])
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformToChatResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseChatStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformToChatStreamChunk(chunk)
  },
}
