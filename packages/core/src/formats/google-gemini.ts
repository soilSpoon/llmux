import {
  parse as parseGeminiRequest,
  transform as transformToGeminiRequest,
} from '../providers/gemini/request'
import {
  parseResponse as parseGeminiResponse,
  transformResponse as transformToGeminiResponse,
} from '../providers/gemini/response'
import {
  parseStreamChunk as parseGeminiStreamChunk,
  transformStreamChunk as transformToGeminiStreamChunk,
} from '../providers/gemini/streaming'
import { isGeminiRequest, isGeminiResponse } from '../providers/gemini/types'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'
import type { FormatContext, SchemaFormat } from './base'

export const GoogleGeminiFormat: SchemaFormat = {
  id: 'google-gemini',

  isSupportedWireRequest(req: unknown): boolean {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return isGeminiRequest(req as any)
  },

  isSupportedWireResponse(res: unknown): boolean {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return isGeminiResponse(res as any)
  },

  parseRequest(req: unknown): UnifiedRequest {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseGeminiRequest(req as any)
  },

  buildWireRequest(unified: UnifiedRequest, _ctx: FormatContext): unknown {
    return transformToGeminiRequest(unified)
  },

  parseResponse(res: unknown): UnifiedResponse {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseGeminiResponse(res as any)
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformToGeminiResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseGeminiStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformToGeminiStreamChunk(chunk)
  },
}
