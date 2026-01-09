import { expect } from 'bun:test'
import type { FormatContext, SchemaFormat } from '../../src/formats/base'
import type {
  ContentPart,
  StreamChunk,
  UnifiedRequest,
  UnifiedResponse,
} from '../../src/types/unified'

/**
 * Result of a round-trip validation containing intermediate states for debugging
 */
export interface RoundTripResult<T> {
  original: T
  unified: UnifiedRequest | UnifiedResponse
  rebuilt: T
  isEqual: boolean
}

/**
 * Options for round-trip validation
 */
export interface RoundTripOptions {
  /** If true, throws when rebuilt doesn't match original */
  strict?: boolean
  /** Custom comparison function */
  compare?: (original: unknown, rebuilt: unknown) => boolean
  /** Fields to ignore during comparison */
  ignoreFields?: string[]
}

/**
 * Deep comparison that ignores specified fields
 */
function deepEqualIgnoring(a: unknown, b: unknown, ignoreFields: string[] = []): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return a === b

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqualIgnoring(item, b[i], ignoreFields))
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj).filter((k) => !ignoreFields.includes(k))
  const bKeys = Object.keys(bObj).filter((k) => !ignoreFields.includes(k))

  if (aKeys.length !== bKeys.length) return false

  return aKeys.every((key) => deepEqualIgnoring(aObj[key], bObj[key], ignoreFields))
}

/**
 * Validates that a format correctly parses a wire request, and that building it back produces
 * a result that matches the original (or expected) wire request.
 */
export function validateRequestRoundTrip(
  format: SchemaFormat,
  wireRequest: unknown,
  ctx: FormatContext,
  assertFn?: (unified: UnifiedRequest) => void,
  options?: RoundTripOptions,
): RoundTripResult<unknown> {
  // 1. Verify support
  expect(format.isSupportedWireRequest(wireRequest)).toBe(true)

  // 2. Parse
  const unified = format.parseRequest(wireRequest)

  // 3. Custom assertions
  if (assertFn) {
    assertFn(unified)
  }

  // 4. Build back
  const rebuilt = format.buildWireRequest(unified, ctx)

  // 5. Compare
  const isEqual = options?.compare
    ? options.compare(wireRequest, rebuilt)
    : deepEqualIgnoring(wireRequest, rebuilt, options?.ignoreFields)

  if (options?.strict && !isEqual) {
    expect(rebuilt).toEqual(wireRequest)
  }

  return {
    original: wireRequest,
    unified,
    rebuilt,
    isEqual,
  }
}

/**
 * Validates that a format correctly parses a wire response, and that building it back produces
 * a result that matches the original wire response.
 */
export function validateResponseRoundTrip(
  format: SchemaFormat,
  wireResponse: unknown,
  ctx: FormatContext,
  assertFn?: (unified: UnifiedResponse) => void,
  options?: RoundTripOptions,
): RoundTripResult<unknown> {
  // 1. Verify support
  expect(format.isSupportedWireResponse(wireResponse)).toBe(true)

  // 2. Parse
  const unified = format.parseResponse(wireResponse)

  // 3. Custom assertions
  if (assertFn) {
    assertFn(unified)
  }

  // 4. Build back
  const rebuilt = format.buildWireResponse(unified, ctx)

  // 5. Compare
  const isEqual = options?.compare
    ? options.compare(wireResponse, rebuilt)
    : deepEqualIgnoring(wireResponse, rebuilt, options?.ignoreFields)

  if (options?.strict && !isEqual) {
    expect(rebuilt).toEqual(wireResponse)
  }

  return {
    original: wireResponse,
    unified,
    rebuilt,
    isEqual,
  }
}

/**
 * Result of cross-format transformation with all intermediate states
 */
export interface CrossFormatResult {
  unified1: UnifiedRequest
  targetWire: unknown
  unified2: UnifiedRequest
  rebuiltSource: unknown
  isSemanticEqual: boolean
}

/**
 * Validates cross-format transformation:
 * Source Format -> Unified -> Target Format -> Unified -> Source Format
 *
 * Ensures that transforming to another format and back preserves the semantic meaning.
 * Note: Some data loss is expected (e.g. provider-specific parameters).
 */
export function validateCrossFormatRoundTrip(
  sourceFormat: SchemaFormat,
  targetFormat: SchemaFormat,
  sourceWireRequest: unknown,
  ctx: FormatContext,
  sourceCtx: FormatContext,
  options?: RoundTripOptions,
): CrossFormatResult {
  // 1. Source -> Unified
  const unified1 = sourceFormat.parseRequest(sourceWireRequest)

  // 2. Unified -> Target
  const targetWire = targetFormat.buildWireRequest(unified1, ctx)

  // 3. Target -> Unified
  const unified2 = targetFormat.parseRequest(targetWire)

  // 4. Unified -> Source
  const rebuiltSource = sourceFormat.buildWireRequest(unified2, sourceCtx)

  // 5. Compare semantically (unified requests should match)
  const isSemanticEqual = options?.compare
    ? options.compare(unified1, unified2)
    : compareUnifiedRequests(unified1, unified2)

  if (options?.strict && !isSemanticEqual) {
    expect(unified2).toEqual(unified1)
  }

  return {
    unified1,
    targetWire,
    unified2,
    rebuiltSource,
    isSemanticEqual,
  }
}

/**
 * Compare two unified requests for semantic equality
 * Ignores ordering differences and focuses on content
 */
export function compareUnifiedRequests(a: UnifiedRequest, b: UnifiedRequest): boolean {
  if (a.messages.length !== b.messages.length) return false

  for (let i = 0; i < a.messages.length; i++) {
    const msgA = a.messages[i]
    const msgB = b.messages[i]
    if (!msgA || !msgB) return false
    if (msgA.role !== msgB.role) return false
    if (!compareContentParts(msgA.parts, msgB.parts)) return false
  }

  if (a.system !== b.system) return false

  return true
}

/**
 * Compare content parts arrays for semantic equality
 */
function compareContentParts(a: ContentPart[], b: ContentPart[]): boolean {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const partA = a[i]
    const partB = b[i]
    if (!partA || !partB) return false
    if (partA.type !== partB.type) return false
    if (partA.text !== partB.text) return false
    if (partA.toolCall?.name !== partB.toolCall?.name) return false
    if (partA.toolResult?.toolCallId !== partB.toolResult?.toolCallId) return false
  }

  return true
}

/**
 * Helper to collect all chunks from a stream and verifying they can be parsed
 */
export function collectStreamChunks(format: SchemaFormat, chunks: string[]): StreamChunk[] {
  if (!format.parseStreamChunk) {
    throw new Error(`Format ${format.id} does not support stream parsing`)
  }

  const results: StreamChunk[] = []

  for (const chunk of chunks) {
    const parsed = format.parseStreamChunk(chunk)
    if (parsed) {
      if (Array.isArray(parsed)) {
        results.push(...parsed)
      } else {
        results.push(parsed)
      }
    }
  }

  return results
}

/**
 * Validates streaming round-trip:
 * Parse stream chunks -> accumulate -> verify final content matches expected
 */
export function validateStreamRoundTrip(
  format: SchemaFormat,
  chunks: string[],
  _ctx: FormatContext,
  expectedContent?: { text?: string; toolCallCount?: number },
): { chunks: StreamChunk[]; accumulatedText: string; toolCalls: StreamChunk[]; thinking: string[] } {
  const parsedChunks = collectStreamChunks(format, chunks)

  let accumulatedText = ''
  const toolCalls: StreamChunk[] = []
  const thinking: string[] = []

  for (const chunk of parsedChunks) {
    if (chunk.delta?.text) {
      accumulatedText += chunk.delta.text
    }
    if (chunk.type === 'tool-call-start' || chunk.type === 'tool_call') {
      toolCalls.push(chunk)
    }
    if (chunk.type === 'thinking' && chunk.delta?.thinking?.text) {
      thinking.push(chunk.delta.thinking.text)
    }
  }

  if (expectedContent?.text !== undefined) {
    expect(accumulatedText).toBe(expectedContent.text)
  }

  if (expectedContent?.toolCallCount !== undefined) {
    expect(toolCalls.length).toBe(expectedContent.toolCallCount)
  }

  return { chunks: parsedChunks, accumulatedText, toolCalls, thinking }
}

/**
 * Create a minimal wire request for testing a specific format
 */
export function createMinimalWireRequest(
  format: SchemaFormat,
  content: string,
  ctx: FormatContext,
): unknown {
  const unified: UnifiedRequest = {
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: content }],
      },
    ],
  }
  return format.buildWireRequest(unified, ctx)
}

/**
 * Create a minimal wire response for testing a specific format
 */
export function createMinimalWireResponse(
  format: SchemaFormat,
  content: string,
  ctx: FormatContext,
): unknown {
  const unified: UnifiedResponse = {
    id: 'test-id',
    content: [{ type: 'text', text: content }],
    stopReason: 'end_turn',
    model: ctx.model,
  }
  return format.buildWireResponse(unified, ctx)
}

/**
 * Assert that a unified request contains specific content
 */
export function assertUnifiedRequestHas(
  unified: UnifiedRequest,
  expectations: {
    messageCount?: number
    system?: string
    toolCount?: number
    hasThinking?: boolean
  },
): void {
  if (expectations.messageCount !== undefined) {
    expect(unified.messages.length).toBe(expectations.messageCount)
  }
  if (expectations.system !== undefined) {
    expect(unified.system).toBe(expectations.system)
  }
  if (expectations.toolCount !== undefined) {
    expect(unified.tools?.length ?? 0).toBe(expectations.toolCount)
  }
  if (expectations.hasThinking !== undefined) {
    expect(unified.thinking?.enabled ?? false).toBe(expectations.hasThinking)
  }
}

/**
 * Assert that a unified response contains specific content
 */
export function assertUnifiedResponseHas(
  unified: UnifiedResponse,
  expectations: {
    contentPartCount?: number
    hasText?: boolean
    hasToolCalls?: boolean
    stopReason?: UnifiedResponse['stopReason']
  },
): void {
  if (expectations.contentPartCount !== undefined) {
    expect(unified.content.length).toBe(expectations.contentPartCount)
  }
  if (expectations.hasText !== undefined) {
    const hasText = unified.content.some((p) => p.type === 'text' && p.text)
    expect(hasText).toBe(expectations.hasText)
  }
  if (expectations.hasToolCalls !== undefined) {
    const hasToolCalls = unified.content.some((p) => p.type === 'tool_call')
    expect(hasToolCalls).toBe(expectations.hasToolCalls)
  }
  if (expectations.stopReason !== undefined) {
    expect(unified.stopReason).toBe(expectations.stopReason)
  }
}

/**
 * Extract all text content from a unified response
 */
export function extractTextFromResponse(unified: UnifiedResponse): string {
  return unified.content
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('')
}

/**
 * Extract all tool calls from a unified response
 */
export function extractToolCallsFromResponse(
  unified: UnifiedResponse,
): Array<{ id: string; name: string; arguments: Record<string, unknown> | string }> {
  return unified.content
    .filter((p) => p.type === 'tool_call' && p.toolCall)
    .map((p) => p.toolCall) as Array<{
    id: string
    name: string
    arguments: Record<string, unknown> | string
  }>
}
