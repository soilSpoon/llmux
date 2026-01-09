import { describe, test, expect } from 'bun:test'
import type { StreamingPipeline } from '../../src/types/streaming-pipeline'
import type { StreamChunk } from '../../src/types/unified'

/**
 * Test suite for AnthropicStreamingPipeline.
 *
 * The pipeline must:
 * 1. Parse Anthropic SSE events to unified StreamChunk
 * 2. Build StreamChunk back to Anthropic SSE
 * 3. Filter out duplicate message_start events
 * 4. Flush remaining state on stream end
 */

describe('AnthropicStreamingPipeline', () => {
  let pipeline: StreamingPipeline

  // Mock pipeline for testing (will be replaced with real implementation)
  function createMockPipeline(): StreamingPipeline {
    const state = {
      messageStartSent: false,
      currentBlockType: null as 'thinking' | 'text' | 'tool_use' | null,
      currentBlockIndex: 0,
    }

    return {
      parse(chunk: string): StreamChunk | StreamChunk[] | null {
        try {
          if (!chunk.trim() || chunk.includes('[DONE]')) return null

          const cleaned = chunk.replace(/^data:\s*/, '').trim()
          if (!cleaned) return null

          const parsed = JSON.parse(cleaned)

          // Anthropic message_start
          if (parsed.type === 'message_start') {
            return {
              type: 'usage',
              usage: {
                inputTokens: parsed.message?.usage?.input_tokens || 0,
                outputTokens: parsed.message?.usage?.output_tokens || 0,
              },
            }
          }

          // Anthropic content_block_start
          if (parsed.type === 'content_block_start') {
            const blockType = parsed.content_block?.type
            state.currentBlockType = blockType
            state.currentBlockIndex = parsed.index || 0

            if (blockType === 'text') {
              return { type: 'text-delta', delta: { text: '' }, blockIndex: parsed.index }
            }
            if (blockType === 'thinking') {
              return { type: 'thinking-start', blockIndex: parsed.index }
            }
            return null
          }

          // Anthropic content_block_delta
          if (parsed.type === 'content_block_delta') {
            const deltaType = parsed.delta?.type
            const index = parsed.index || 0

            if (deltaType === 'text_delta') {
              return { type: 'text-delta', delta: { text: parsed.delta.text }, blockIndex: index }
            }
            if (deltaType === 'thinking_delta') {
              return {
                type: 'thinking-delta',
                delta: { thinking: { text: parsed.delta.thinking } },
                blockIndex: index,
              }
            }
            return null
          }

          // Anthropic content_block_stop
          if (parsed.type === 'content_block_stop') {
            return { type: 'block_stop' }
          }

          // Anthropic message_delta
          if (parsed.type === 'message_delta') {
            return {
              type: 'finish',
              finishReason: { unified: 'end_turn', raw: 'message_delta' },
              usage: parsed.usage && {
                inputTokens: 0,
                outputTokens: parsed.usage.output_tokens || 0,
              },
            }
          }

          // Anthropic message_stop
          if (parsed.type === 'message_stop') {
            return { type: 'finish', finishReason: { unified: 'end_turn', raw: 'message_stop' } }
          }

          return null
        } catch {
          return null
        }
      },

      build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
        const chunks = Array.isArray(chunk) ? chunk : [chunk]
        const results: string[] = []

        for (const c of chunks) {
          // Auto-emit message_start on first content block
          if (!state.messageStartSent && (c.type === 'text-delta' || c.type === 'thinking-start')) {
            const msgStart = JSON.stringify({
              type: 'message_start',
              message: {
                id: `msg_${Math.random().toString(36).slice(2, 11)}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-3-sonnet',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            })
            results.push(`data: ${msgStart}\n\n`)
            state.messageStartSent = true
          }

          // Convert StreamChunk to Anthropic SSE
          if (c.type === 'text-delta' && c.delta?.text) {
            const evt = JSON.stringify({
              type: 'content_block_delta',
              index: c.blockIndex || 0,
              delta: { type: 'text_delta', text: c.delta.text },
            })
            results.push(`data: ${evt}\n\n`)
          } else if (c.type === 'thinking-delta' && c.delta?.thinking) {
            const evt = JSON.stringify({
              type: 'content_block_delta',
              index: c.blockIndex || 0,
              delta: { type: 'thinking_delta', thinking: c.delta.thinking.text },
            })
            results.push(`data: ${evt}\n\n`)
          } else if (c.type === 'finish') {
            const evt = JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: c.usage || { input_tokens: 0, output_tokens: 0 },
            })
            results.push(`data: ${evt}\n\n`)
          }
        }

        return results.length > 0 ? results : null
      },

      filter(): boolean {
        // Skip auto-generated message_start in transformed chunks
        // (because build() already emitted one)
        // But wait - build() emits it, so we never get here with message_start...
        // Actually, this is for filtering OTHER message_start events from the stream.
        // If source format has message_start that we want to skip, do it here.
        return true // For now, include all
      },

      flush(): string | null {
        if (state.currentBlockType) {
          const evt = JSON.stringify({
            type: 'content_block_stop',
            index: state.currentBlockIndex,
          })
          return `data: ${evt}\n\n`
        }
        return null
      },
    }
  }

  describe('parse()', () => {
    test('parses Anthropic message_start event', () => {
      pipeline = createMockPipeline()

      const chunk = `data: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_123',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      })}\n\n`

      const result = pipeline.parse(chunk)

      expect(result).toEqual({
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 0 },
      })
    })

    test('parses Anthropic content_block_start (text)', () => {
      pipeline = createMockPipeline()

      const chunk = `data: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })}\n\n`

      const result = pipeline.parse(chunk)

      expect(result).toEqual({
        type: 'text-delta',
        delta: { text: '' },
        blockIndex: 0,
      })
    })

    test('parses Anthropic content_block_delta (text)', () => {
      pipeline = createMockPipeline()

      const chunk = `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      })}\n\n`

      const result = pipeline.parse(chunk)

      expect(result).toEqual({
        type: 'text-delta',
        delta: { text: 'Hello' },
        blockIndex: 0,
      })
    })

    test('returns null for [DONE] marker', () => {
      pipeline = createMockPipeline()

      const chunk = 'data: [DONE]\n\n'
      const result = pipeline.parse(chunk)

      expect(result).toBeNull()
    })

    test('returns null for invalid JSON', () => {
      pipeline = createMockPipeline()

      const chunk = 'data: {invalid json}\n\n'
      const result = pipeline.parse(chunk)

      expect(result).toBeNull()
    })
  })

  describe('build()', () => {
    test('builds text-delta to Anthropic SSE', () => {
      pipeline = createMockPipeline()

      const chunk: StreamChunk = {
        type: 'text-delta',
        delta: { text: 'Hello' },
        blockIndex: 0,
      }

      const result = pipeline.build(chunk)

      expect(Array.isArray(result)).toBe(true)
      const [msgStart, textDelta] = result as string[]

      expect(msgStart).toContain('"type":"message_start"')
      expect(textDelta).toContain('"type":"content_block_delta"')
      expect(textDelta).toContain('"text":"Hello"')
    })

    test('emits message_start only once on first content block', () => {
      pipeline = createMockPipeline()

      const chunk1: StreamChunk = { type: 'text-delta', delta: { text: 'H' }, blockIndex: 0 }
      const chunk2: StreamChunk = { type: 'text-delta', delta: { text: 'i' }, blockIndex: 0 }

      const result1 = pipeline.build(chunk1)
      const result2 = pipeline.build(chunk2)

      expect(Array.isArray(result1)).toBe(true)
      expect((result1 as string[]).some((s) => s.includes('message_start'))).toBe(true)

      expect(Array.isArray(result2)).toBe(true)
      expect((result2 as string[]).some((s) => s.includes('message_start'))).toBe(false)
    })
  })

  describe('filter()', () => {
    test('includes all valid output by default', () => {
      pipeline = createMockPipeline()

      const testOutput = 'data: {"type":"content_block_delta"}\n\n'
      expect(pipeline.filter(testOutput)).toBe(true)
    })
  })

  describe('flush()', () => {
    test('emits content_block_stop on flush', () => {
      pipeline = createMockPipeline()

      // Simulate starting a text block
      pipeline.parse(`data: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      })}\n\n`)

      const flushed = pipeline.flush()

      expect(flushed).toContain('"type":"content_block_stop"')
      expect(flushed).toContain('"index":0')
    })

    test('returns null if no open block', () => {
      pipeline = createMockPipeline()

      const flushed = pipeline.flush()

      expect(flushed).toBeNull()
    })
  })

  describe('Round-trip: parse → build', () => {
    test('preserves text content through round-trip', () => {
      pipeline = createMockPipeline()

      const original = `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'test content' },
      })}\n\n`

      // Parse to unified
      const parsed = pipeline.parse(original)
      expect(parsed).toBeTruthy()

      // Build back to Anthropic
      const built = pipeline.build(parsed as StreamChunk)
      expect(built).toBeTruthy()

      const builtStr = (Array.isArray(built) ? built[built.length - 1] : built) as string
      expect(builtStr).toContain('test content')
    })
  })
})
