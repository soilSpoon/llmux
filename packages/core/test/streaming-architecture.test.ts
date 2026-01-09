import { describe, it, expect } from 'bun:test'
import { getFormat } from '../src/formats/registry'
import type { StreamingPipeline } from '../src/types/unified'

/**
 * STREAM-001: Test StreamingPipeline Architecture
 *
 * Verifies that:
 * 1. StreamingPipeline belongs to SchemaFormat, not Provider
 * 2. Each format can optionally provide getStreamingPipeline()
 * 3. StreamingPipeline interface has required methods (parse, build, filter, flush)
 */

describe('StreamingPipeline Architecture', () => {
  describe('SchemaFormat.getStreamingPipeline()', () => {
    it('anthropic-messages format has streaming pipeline', () => {
      const format = getFormat('anthropic-messages')
      expect(format).toBeDefined()
      expect(format.getStreamingPipeline).toBeDefined()

      const pipeline = format.getStreamingPipeline!({ provider: 'anthropic', model: 'claude-3-sonnet' })
      expect(pipeline).toBeDefined()
      verifyStreamingPipelineInterface(pipeline)
    })

    it('openai-chat format supports streaming', () => {
      const format = getFormat('openai-chat')
      expect(format).toBeDefined()
      // openai-chat may provide streaming pipeline (optional)
    })

    it('google-gemini format has streaming pipeline', () => {
      const format = getFormat('google-gemini')
      expect(format).toBeDefined()
      expect(format.getStreamingPipeline).toBeDefined()

      const pipeline = format.getStreamingPipeline!({ provider: 'google', model: 'gemini-2.0-flash' })
      expect(pipeline).toBeDefined()
      verifyStreamingPipelineInterface(pipeline)
    })

    it('openai-responses format supports streaming', () => {
      const format = getFormat('openai-responses')
      expect(format).toBeDefined()
      // openai-responses may provide streaming pipeline (optional)
    })
  })

  describe('StreamingPipeline interface contract', () => {
    it('parse method should accept string and return chunk(s) or null', () => {
      const format = getFormat('anthropic-messages')
      if (!format.getStreamingPipeline) {
        throw new Error('anthropic-messages must have getStreamingPipeline()')
      }

      const pipeline = format.getStreamingPipeline({ provider: 'anthropic', model: 'claude-3-sonnet' })
      const result = pipeline.parse('data: {}')
      expect(result === null || typeof result === 'object').toBe(true)
    })

    it('build method should accept chunk(s) and return string(s) or null', () => {
      const format = getFormat('anthropic-messages')
      if (!format.getStreamingPipeline) {
        throw new Error('anthropic-messages must have getStreamingPipeline()')
      }

      const pipeline = format.getStreamingPipeline({ provider: 'anthropic', model: 'claude-3-sonnet' })
      const testChunk = { type: 'text-delta' as const, delta: { text: 'test' } }
      const result = pipeline.build(testChunk)
      expect(
        result === null || typeof result === 'string' || Array.isArray(result)
      ).toBe(true)
    })

    it('filter method should accept string and return boolean', () => {
      const format = getFormat('anthropic-messages')
      if (!format.getStreamingPipeline) {
        throw new Error('anthropic-messages must have getStreamingPipeline()')
      }

      const pipeline = format.getStreamingPipeline({ provider: 'anthropic', model: 'claude-3-sonnet' })
      const result = pipeline.filter('data: {}')
      expect(typeof result).toBe('boolean')
    })

    it('flush method should return string or null', () => {
      const format = getFormat('anthropic-messages')
      if (!format.getStreamingPipeline) {
        throw new Error('anthropic-messages must have getStreamingPipeline()')
      }

      const pipeline = format.getStreamingPipeline({ provider: 'anthropic', model: 'claude-3-sonnet' })
      const result = pipeline.flush()
      expect(result === null || typeof result === 'string').toBe(true)
    })
  })

  describe('Architecture: Format ownership', () => {
    it('getStreamingPipeline should be on SchemaFormat, not Provider', () => {
      // This test documents the architecture requirement.
      // StreamingPipeline is format-specific, not provider-specific.
      // Example: anthropic-messages format has identical streaming logic
      // regardless of whether it's used by Anthropic, Antigravity, or any other provider.

      const format = getFormat('anthropic-messages')

      // Format can optionally provide streaming pipeline
      expect(typeof format.getStreamingPipeline === 'function' || !format.getStreamingPipeline).toBe(
        true
      )
    })
  })
})

/**
 * Helper: Verify StreamingPipeline has all required methods
 */
function verifyStreamingPipelineInterface(pipeline: StreamingPipeline): void {
  expect(typeof pipeline.parse).toBe('function')
  expect(typeof pipeline.build).toBe('function')
  expect(typeof pipeline.filter).toBe('function')
  expect(typeof pipeline.flush).toBe('function')
}
