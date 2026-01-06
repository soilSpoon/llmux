import { isResponsesApiRequest } from '../providers/openai/format-detector'
import {
  parse as parseOpenAIRequest,
  transform as transformToOpenAIRequest,
} from '../providers/openai/request'
import {
  parseResponse as parseOpenAIResponse,
  transformResponse as transformToOpenAIResponse,
} from '../providers/openai/response'
import {
  parseStreamChunk as parseOpenAIStreamChunk,
  transformStreamChunk as transformToOpenAIStreamChunk,
} from '../providers/openai/streaming'
import { isOpenAIRequest, isOpenAIResponse } from '../providers/openai/types'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'
import type { FormatContext, SchemaFormat } from './base'

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
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseOpenAIRequest(req as any)
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    const transformed = transformToOpenAIRequest(unified, ctx.model)

    // Fix content types for Responses API (text -> input_text)
    if (transformed.messages) {
      transformed.messages = transformed.messages.map((msg) => {
        if (Array.isArray(msg.content)) {
          // biome-ignore lint/suspicious/noExplicitAny: transforming specific types
          const newContent = msg.content.map((part: any) => {
            if (part.type === 'text') {
              return { ...part, type: 'input_text' }
            }
            return part
          })
          return { ...msg, content: newContent }
        }
        return msg
      })
    }

    return transformed
  },

  parseResponse(res: unknown): UnifiedResponse {
    return parseOpenAIResponse(res as Parameters<typeof parseOpenAIResponse>[0])
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformToOpenAIResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseOpenAIStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformToOpenAIStreamChunk(chunk)
  },
}
