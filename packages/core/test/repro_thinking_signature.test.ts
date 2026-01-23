import { describe, it, expect } from 'bun:test'
import { AnthropicStreamingBuilder } from '../src/formats/anthropic-messages/anthropic-streaming-builder'
import type { StreamChunk } from '../src/types/unified'

describe('AnthropicStreamingBuilder', () => {
  it('should emit signature_delta when chunk has signature', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-opus')
    
    // 1. Start thinking
    const chunk1: StreamChunk = {
      type: 'thinking-delta',
      delta: {
        thinking: { text: 'Thinking...' }
      }
    }
    const events1 = builder.build(chunk1)
    expect(events1.some(e => e.includes('thinking_delta'))).toBe(true)

    // 2. Send signature only
    const chunk2: StreamChunk = {
      type: 'thinking-delta',
      delta: {
        thinking: { text: '', signature: 'test_signature_123' }
      }
    }
    const events2 = builder.build(chunk2)

    const hasSignature = events2.some(e => e.includes('"type":"signature_delta"') && e.includes('test_signature_123'))
    expect(hasSignature).toBe(true)
  })

  it('should emit text_delta correctly', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-opus')
    
    const chunk: StreamChunk = {
      type: 'text-delta',
      delta: {
        text: 'Hello world'
      }
    }
    
    const events = builder.build(chunk)
    // Should start message, start block, and emit delta
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.some(e => e.includes('message_start'))).toBe(true)
    expect(events.some(e => e.includes('content_block_start'))).toBe(true)
    expect(events.some(e => e.includes('text_delta') && e.includes('Hello world'))).toBe(true)
  })

  it('should handle thinking with text and signature in same chunk', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-opus')

    const chunk: StreamChunk = {
        type: 'thinking-delta',
        delta: {
            thinking: { text: 'Final thought', signature: 'sig_combined' }
        }
    }

    const events = builder.build(chunk)
    // Should have thinking_delta AND signature_delta
    const hasThinking = events.some(e => e.includes('thinking_delta') && e.includes('Final thought'))
    const hasSignature = events.some(e => e.includes('signature_delta') && e.includes('sig_combined'))
    
    expect(hasThinking).toBe(true)
    expect(hasSignature).toBe(true)
  })
})