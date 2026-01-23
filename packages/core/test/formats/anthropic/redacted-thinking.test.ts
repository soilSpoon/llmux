
import { describe, it, expect } from 'bun:test'
import { AnthropicStreamingBuilder } from '../../../src/formats/anthropic-messages/anthropic-streaming-builder'
import type { StreamChunk } from '../../../src/types/unified'

describe('Anthropic Streaming Builder - Redacted Thinking', () => {
  it('should handle redacted thinking blocks', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-7-sonnet')
    
    // Simulate incoming redacted thinking chunk
    const chunk: StreamChunk = {
      type: 'redacted-thinking',
      blockIndex: 0,
      blockType: 'redacted_thinking',
      delta: {
        type: 'redacted_thinking',
        redactedThinking: 'DATA_REDACTED_BY_POLICY'
      }
    }

    const events = builder.build(chunk)
    
    // Expect message_start and content_block_start with correct type and data
    const combined = events.join('')
    expect(combined).toContain('event: message_start')
    expect(combined).toContain('event: content_block_start')
    expect(combined).toContain('"type":"redacted_thinking"')
    expect(combined).toContain('"data":"DATA_REDACTED_BY_POLICY"')
  })

  it('should transition between thinking and redacted thinking', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-7-sonnet')
    
    // 1. Regular thinking
    builder.build({
      type: 'thinking-start',
      blockIndex: 0
    })
    
    // 2. Redacted thinking (new block)
    const events = builder.build({
      type: 'redacted-thinking',
      blockIndex: 1,
      delta: {
        type: 'redacted_thinking',
        redactedThinking: 'REDACTED'
      }
    })
    
    const combined = events.join('')
    
    // Should close previous block and start redacted block
    expect(combined).toContain('event: content_block_stop') // Close thinking
    expect(combined).toContain('event: content_block_start') // Start redacted
    expect(combined).toContain('"type":"redacted_thinking"')
  })
})
