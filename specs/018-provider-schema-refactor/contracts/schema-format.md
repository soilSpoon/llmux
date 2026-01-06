# Contract: SchemaFormat Interface

**Location**: `packages/core/src/formats/base.ts`
**Type**: TypeScript Interface

## Interface Definition

```typescript
import type { FormatId, UnifiedRequest, UnifiedResponse, StreamChunk, FormatContext } from './types'

/**
 * SchemaFormat defines the contract for a wire format transformation strategy.
 * 
 * Each format implementation handles parsing from and building to a specific
 * wire format (e.g., OpenAI Chat, Anthropic Messages, etc.).
 * 
 * The transformation follows a hub-and-spoke pattern:
 * - Wire Format → Unified (parse)
 * - Unified → Wire Format (build)
 */
export interface SchemaFormat {
  /**
   * Unique identifier for this format.
   */
  readonly id: FormatId

  // ─────────────────────────────────────────────────────────────────
  // Type Guards
  // ─────────────────────────────────────────────────────────────────

  /**
   * Determine if a wire request matches this format.
   * Used for auto-detection when format is not explicitly specified.
   * 
   * @param request - Unknown wire request object
   * @returns true if this format can handle the request
   * 
   * @example
   * // OpenAI Chat: has 'messages' array, no 'input' field
   * isSupportedWireRequest(req) {
   *   return typeof req.model === 'string' && 
   *          Array.isArray(req.messages) && 
   *          !('input' in req)
   * }
   */
  isSupportedWireRequest(request: unknown): boolean

  /**
   * Determine if a wire response matches this format.
   * 
   * @param response - Unknown wire response object
   * @returns true if this format can handle the response
   */
  isSupportedWireResponse(response: unknown): boolean

  // ─────────────────────────────────────────────────────────────────
  // Request Transformation
  // ─────────────────────────────────────────────────────────────────

  /**
   * Parse a wire request into unified format.
   * 
   * @param request - Wire request object in this format
   * @returns Unified request representation
   * @throws Error if request is malformed or missing critical fields
   * 
   * @example
   * const unified = OpenAIChatFormat.parseRequest({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Hello' }]
   * })
   */
  parseRequest(request: unknown): UnifiedRequest

  /**
   * Build a wire request from unified format.
   * 
   * @param unified - Unified request representation
   * @param ctx - Format context (provider, model, config)
   * @returns Wire request object in this format
   * 
   * @example
   * const wire = OpenAIChatFormat.buildWireRequest(unified, {
   *   provider: 'openai',
   *   model: 'gpt-4'
   * })
   */
  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown

  // ─────────────────────────────────────────────────────────────────
  // Response Transformation
  // ─────────────────────────────────────────────────────────────────

  /**
   * Parse a wire response into unified format.
   * 
   * @param response - Wire response object in this format
   * @returns Unified response representation
   * @throws Error if response is malformed or missing critical fields
   */
  parseResponse(response: unknown): UnifiedResponse

  /**
   * Build a wire response from unified format.
   * 
   * @param unified - Unified response representation
   * @param ctx - Format context
   * @returns Wire response object in this format
   */
  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown

  // ─────────────────────────────────────────────────────────────────
  // Streaming (Optional)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Parse a streaming chunk from wire format.
   * 
   * @param chunk - Raw chunk string (e.g., SSE data line)
   * @returns Parsed stream chunk(s), or null if chunk is not data
   * 
   * Optional - implement if format supports streaming.
   */
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null

  /**
   * Build a streaming chunk for wire format.
   * 
   * @param chunk - Unified stream chunk
   * @param ctx - Format context
   * @returns Wire format string(s) (e.g., SSE lines)
   * 
   * Optional - implement if format supports streaming.
   */
  buildStreamChunk?(chunk: StreamChunk, ctx: FormatContext): string | string[]

  // ─────────────────────────────────────────────────────────────────
  // Error Handling (Optional)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Parse an error response from the provider.
   * 
   * @param error - Error response or exception
   * @returns Normalized error information
   * 
   * Optional - provides format-specific error parsing.
   */
  parseError?(error: unknown): { 
    message: string
    code?: string
    status?: number 
  }
}
```

## Format Context

```typescript
/**
 * Context passed to build methods.
 */
export interface FormatContext {
  /** Provider identifier (e.g., 'openai', 'anthropic') */
  provider: string
  
  /** Model identifier (e.g., 'gpt-4', 'claude-3-opus') */
  model: string
  
  /** Additional provider-specific configuration */
  config?: Record<string, unknown>
}
```

## Format ID Enum

```typescript
/**
 * Supported wire format identifiers.
 */
export type FormatId = 
  | 'openai-chat'       // /v1/chat/completions
  | 'openai-responses'  // /v1/responses
  | 'anthropic-messages' // /v1/messages
  | 'google-gemini'     // /v1/models/{model}:generateContent
```

## Implementation Requirements

1. **Type Guards**: Must accurately detect format from wire request/response
2. **Lossless Round-Trip**: `parseRequest` → `buildWireRequest` must preserve all data
3. **Error Handling**: Throw descriptive errors for malformed input
4. **Streaming**: Optional but recommended for production use
5. **Logging**: Log warnings for lossy cross-format transformations

## Example Implementation Skeleton

```typescript
export const OpenAIChatFormat: SchemaFormat = {
  id: 'openai-chat',

  isSupportedWireRequest(req: unknown): boolean {
    if (!req || typeof req !== 'object') return false
    const r = req as Record<string, unknown>
    return typeof r.model === 'string' && 
           Array.isArray(r.messages) && 
           !('input' in r)
  },

  isSupportedWireResponse(res: unknown): boolean {
    if (!res || typeof res !== 'object') return false
    const r = res as Record<string, unknown>
    return r.object === 'chat.completion' || 
           r.object === 'chat.completion.chunk'
  },

  parseRequest(request: unknown): UnifiedRequest {
    // Implementation...
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    // Implementation...
  },

  parseResponse(response: unknown): UnifiedResponse {
    // Implementation...
  },

  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown {
    // Implementation...
  },

  parseStreamChunk(chunk: string): StreamChunk | null {
    // Implementation...
  },

  buildStreamChunk(chunk: StreamChunk, ctx: FormatContext): string {
    // Implementation...
  }
}
```

## See Also

- [data-model.md](data-model.md) - Unified schema entities
- [schemas/unified.md](schemas/unified.md) - Full type definitions
- [test-cases.md](test-cases.md) - Test cases for interface compliance
