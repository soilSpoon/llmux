import {
  parse as parseAnthropicRequest,
  transform as transformToAnthropicRequest,
} from '../providers/anthropic/request'
import {
  parseResponse as parseAnthropicResponse,
  transformResponse as transformToAnthropicResponse,
} from '../providers/anthropic/response'
import {
  parseStreamChunk as parseAnthropicStreamChunk,
  transformStreamChunk as transformToAnthropicStreamChunk,
} from '../providers/anthropic/streaming'
import { isAnthropicRequest, isAnthropicResponse } from '../providers/anthropic/types'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../types/unified'
import type { FormatContext, SchemaFormat } from './base'

export const AnthropicMessagesFormat: SchemaFormat = {
  id: 'anthropic-messages',

  isSupportedWireRequest(req: unknown): boolean {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return isAnthropicRequest(req as any)
  },

  isSupportedWireResponse(res: unknown): boolean {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return isAnthropicResponse(res as any)
  },

  parseRequest(req: unknown): UnifiedRequest {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseAnthropicRequest(req as any)
  },

  buildWireRequest(unified: UnifiedRequest, _ctx: FormatContext): unknown {
    return transformToAnthropicRequest(unified)
  },

  parseResponse(res: unknown): UnifiedResponse {
    // biome-ignore lint/suspicious/noExplicitAny: existing types are loose
    return parseAnthropicResponse(res as any)
  },

  buildWireResponse(unified: UnifiedResponse, _ctx: FormatContext): unknown {
    return transformToAnthropicResponse(unified)
  },

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    return parseAnthropicStreamChunk(chunk)
  },

  buildStreamChunk(chunk: StreamChunk, _ctx: FormatContext): string | string[] {
    return transformToAnthropicStreamChunk(chunk)
  },
}
