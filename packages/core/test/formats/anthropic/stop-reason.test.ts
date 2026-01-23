import { describe, expect, it } from 'bun:test'
import { AnthropicStreamingBuilder } from '../../../src/formats/anthropic-messages/anthropic-streaming-builder'

describe('Anthropic Stop Reason Handling', () => {
  it('should map stop to end_turn', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-7-sonnet')
    
    const events = builder.build({
      type: 'finish',
      finishReason: { unified: 'end_turn', raw: 'stop' }
    })
    
    const deltaEvent = events.find(e => e.includes('message_delta'))
    expect(deltaEvent).toContain('"stop_reason":"end_turn"')
  })

  it('should map tool_calls to tool_use', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-7-sonnet')
    
    // Simulating tool use block was started
    builder.build({
        type: 'tool-call-start',
        toolCall: { id: 'call_1', name: 'test' }
    })

    const events = builder.build({
      type: 'finish',
      finishReason: { unified: 'tool_use', raw: 'tool_calls' }
    })
    
    const deltaEvent = events.find(e => e.includes('message_delta'))
    expect(deltaEvent).toContain('"stop_reason":"tool_use"')
  })

  it('should map length to max_tokens', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-7-sonnet')
    
    const events = builder.build({
      type: 'finish',
      finishReason: { unified: 'max_tokens', raw: 'length' }
    })
    
    const deltaEvent = events.find(e => e.includes('message_delta'))
    expect(deltaEvent).toContain('"stop_reason":"max_tokens"')
  })
})