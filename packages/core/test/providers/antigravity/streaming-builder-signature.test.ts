import { describe, expect, it } from 'bun:test'
import { AntigravityStreamingBuilder } from '../../../src/providers/antigravity/streaming-builder'
import type { AntigravityBuilderState } from '../../../src/providers/antigravity/streaming-builder'
import type { StreamChunk } from '../../../src/types/unified'

describe('AntigravityStreamingBuilder - Signature Support', () => {
  const mockState: AntigravityBuilderState = {
    messageStartGenerated: true,
    currentBlockType: 'thinking',
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    finishReason: null,
    finalUsage: null,
    messageStopEmitted: false,
    messageStartFiltered: false,
    streamingState: {
      hasThinkingStarted: true,
      hasThinkingEnded: false,
      hasTextStarted: false,
    },
  }

  it('should emit signature_delta when thinking chunk has signature', () => {
    const builder = new AntigravityStreamingBuilder({ ...mockState }, 'test-model')
    
    const chunk: StreamChunk = {
      type: 'thinking-delta',
      delta: {
        thinking: {
          text: 'some thought',
          signature: 'test-signature-123'
        }
      }
    }

    const results = builder.build(chunk)
    
    expect(results).not.toBeNull()
    expect(results?.length).toBe(2)
    
    // First event: thinking text delta
    expect(results![0]).toContain('"type":"content_block_delta"')
    expect(results![0]).toContain('"type":"thinking_delta"')
    expect(results![0]).toContain('"thinking":"some thought"')
    
    // Second event: signature delta
    expect(results![1]).toContain('"type":"content_block_delta"')
    expect(results![1]).toContain('"type":"signature_delta"')
    expect(results![1]).toContain('"signature":"test-signature-123"')
  })

  it('should NOT emit signature_delta when thinking chunk has NO signature', () => {
    const builder = new AntigravityStreamingBuilder({ ...mockState }, 'test-model')
    
    const chunk: StreamChunk = {
      type: 'thinking-delta',
      delta: {
        thinking: {
          text: 'just thought',
          // no signature
        }
      }
    }

    const results = builder.build(chunk)
    
    expect(results).not.toBeNull()
    expect(results?.length).toBe(1)
    
    expect(results![0]).toContain('"type":"thinking_delta"')
    expect(results![0]).not.toContain('"type":"signature_delta"')
  })
})
