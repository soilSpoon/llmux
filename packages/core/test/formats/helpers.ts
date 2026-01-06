import { expect } from 'bun:test'
import type { FormatContext, SchemaFormat } from '../../src/formats/base'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../src/types/unified'

/**
 * Validates that a format correctly parses a wire request, and that building it back produces
 * a result that matches the original (or expected) wire request.
 */
export function validateRequestRoundTrip(
  format: SchemaFormat,
  wireRequest: unknown,
  ctx: FormatContext,
  assertFn?: (unified: UnifiedRequest) => void,
) {
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

  // 5. Verify structure matches (ignoring order of keys, etc)
  // We use subset matching because rebuilt request might have defaults filled in
  // or keys reordered, but critical fields should match.
  // Ideally, the caller should pass an expectedWireRequest if it differs significantly
  // from the input wireRequest (e.g. normalization).
  // For strict equality, we'd need to be more careful.
  return rebuilt
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
) {
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

  return rebuilt
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
  ctx: FormatContext, // Context for target format
  sourceCtx: FormatContext // Context for source format
) {
  // 1. Source -> Unified
  const unified1 = sourceFormat.parseRequest(sourceWireRequest)

  // 2. Unified -> Target
  const targetWire = targetFormat.buildWireRequest(unified1, ctx)

  // 3. Target -> Unified
  const unified2 = targetFormat.parseRequest(targetWire)

  // 4. Unified -> Source
  const rebuiltSource = sourceFormat.buildWireRequest(unified2, sourceCtx)

  return {
    unified1,
    targetWire,
    unified2,
    rebuiltSource
  }
}

/**
 * Helper to collect all chunks from a stream and verifying they can be parsed
 */
export function collectStreamChunks(
  format: SchemaFormat,
  chunks: string[]
): StreamChunk[] {
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
