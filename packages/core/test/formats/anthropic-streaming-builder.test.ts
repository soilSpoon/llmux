import { describe, expect, test } from 'bun:test'
import { AnthropicStreamingBuilder } from '../../src/formats/anthropic-messages/anthropic-streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

describe('AnthropicStreamingBuilder', () => {
  const model = 'claude-3-opus-20240229'

  test('should handle tool call in delta.toolCall (Gemini style)', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. First chunk (Gemini style tool call)
    const chunk: StreamChunk = {
      type: 'tool_call',
      blockIndex: 0,
      delta: {
        type: 'tool_call',
        toolCall: {
          id: 'call_123',
          name: 'get_weather',
          arguments: { city: 'Seoul' }
        },
        partialJson: '{"city": "Seoul"}'
      }
    }

    const events = builder.build(chunk)
    
    // Check message_start
    expect(events[0]).toContain('"type":"message_start"')
    
    // Check content_block_start with correct tool name
    expect(events[1]).toContain('"type":"content_block_start"')
    expect(events[1]).toContain('"name":"get_weather"')
    expect(events[1]).toContain('"id":"call_123"')
    
    // Check content_block_delta
    expect(events[2]).toContain('"type":"content_block_delta"')
    expect(events[2]).toContain('"partial_json":"{\\"city\\": \\"Seoul\\"}"')
  })

  test('should patch stop_reason to tool_use when tool block was present', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. Tool call start
    builder.build({
      type: 'tool_call',
      blockIndex: 0,
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_123', name: 'oracle', arguments: {} }
      }
    })

    // 2. Done chunk with end_turn (Gemini style)
    const doneChunk: StreamChunk = {
      type: 'done',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 }
    }

    const events = builder.build(doneChunk)
    
    // Find message_delta
    const msgDelta = events.find(e => e.includes('"type":"message_delta"'))
    expect(msgDelta).toBeDefined()
    expect(msgDelta).toContain('"stop_reason":"tool_use"') // Should be patched
    expect(msgDelta).toContain('"usage":{"input_tokens":10,"output_tokens":20}')
  })

  test('should handle multiple content blocks correctly', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. Text block
    const textChunk: StreamChunk = {
      type: 'content',
      blockIndex: 0,
      delta: { type: 'text', text: 'Thinking...' }
    }
    const events1 = builder.build(textChunk)
    expect(events1[0]).toContain('"type":"message_start"')
    expect(events1[1]).toContain('"type":"content_block_start"')
    expect(events1[1]).toContain('"type":"text"')
    
    // 2. Tool call block (New block)
    const toolChunk: StreamChunk = {
      type: 'tool_call',
      blockIndex: 1,
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_123', name: 'search', arguments: {} }
      }
    }
    const events2 = builder.build(toolChunk)
    
    // Should stop previous block at index 0
    expect(events2[0]).toContain('"type":"content_block_stop"')
    expect(events2[0]).toContain('"index":0')
    
    // Should start new block at index 1
    expect(events2[1]).toContain('"index":1')
    expect(events2[1]).toContain('"type":"tool_use"')
  })

  test('should increment index even if source provides same index 0 (Gemini style)', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. First block (index 0)
    builder.build({
      type: 'content',
      blockIndex: 0,
      delta: { type: 'text', text: 'First' }
    })

    // 2. Second block (still index 0 from source, e.g. Gemini candidate index)
    const events = builder.build({
      type: 'tool_call',
      blockIndex: 0,
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'tool', arguments: {} }
      }
    })
    
    // Should stop index 0
    expect(events[0]).toContain('"type":"content_block_stop"')
    expect(events[0]).toContain('"index":0')
    
    // Should start index 1 (Auto-incremented)
    expect(events[1]).toContain('"type":"content_block_start"')
    expect(events[1]).toContain('"index":1')
  })

  test('should handle implicit finish in tool_call chunk', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    const chunk: StreamChunk = {
      type: 'tool_call',
      blockIndex: 1,
      stopReason: 'end_turn', // Gemini often includes finish in the same chunk
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_123', name: 'search', arguments: {} },
        partialJson: '{}'
      }
    }

    const events = builder.build(chunk)
    
    // Should contain message_delta with stop_reason: tool_use
    const msgDelta = events.find(e => e.includes('"type":"message_delta"'))
    expect(msgDelta).toContain('"stop_reason":"tool_use"')
    
    // Should contain message_stop
    expect(events.some(e => e.includes('"type":"message_stop"'))).toBe(true)
  })

  test('should handle complex transition: thinking -> text -> tool_use', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. Thinking
    const e1 = builder.build({
      type: 'thinking-delta',
      delta: { thinking: { text: 'Thought' } }
    })
    expect(e1.some(e => e.includes('"type":"thinking_delta"'))).toBe(true)

    // 2. Text (Should close thinking, start text)
    const e2 = builder.build({
      type: 'text-delta',
      delta: { text: 'Hello' }
    })
    expect(e2[0]).toContain('"type":"content_block_stop"')
    expect(e2[1]).toContain('"type":"content_block_start"')
    expect(e2[1]).toContain('"type":"text"')
    expect(e2[2]).toContain('"type":"text_delta"')

    // 3. Tool Use (Should close text, start tool)
    const e3 = builder.build({
      type: 'tool_call',
      delta: { toolCall: { name: 'calculator', id: 'c1', arguments: {} } }
    })
    expect(e3[0]).toContain('"type":"content_block_stop"')
    expect(e3[1]).toContain('"type":"content_block_start"')
    expect(e3[1]).toContain('"type":"tool_use"')
    expect(e3[1]).toContain('"name":"calculator"')
  })

  test('should handle sequential tool calls with auto-incrementing indices', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // First tool
    builder.build({
      type: 'tool_call',
      delta: { toolCall: { name: 'tool1', id: 'id1', arguments: {} } }
    })
    
    // Second tool (Source might still say index 0 if it's from a different generator part)
    const events = builder.build({
      type: 'tool_call',
      blockIndex: 0, 
      delta: { toolCall: { name: 'tool2', id: 'id2', arguments: {} } }
    })
    
    expect(events[0]).toContain('"type":"content_block_stop"')
    expect(events[0]).toContain('"index":0')
    
    expect(events[1]).toContain('"type":"content_block_start"')
    expect(events[1]).toContain('"index":1') // Auto-incremented
    expect(events[1]).toContain('"name":"tool2"')
  })

  test('should properly close blocks on flush()', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    builder.build({
      type: 'text-delta',
      delta: { text: 'Unfinished' }
    })
    
    const flushEvents = builder.flush()
    expect(flushEvents.length).toBe(3)
    expect(flushEvents[0]).toContain('"type":"content_block_stop"')
    expect(flushEvents[0]).toContain('"index":0')
    expect(flushEvents[1]).toContain('"type":"message_delta"')
    expect(flushEvents[1]).toContain('"stop_reason":"end_turn"')
    expect(flushEvents[2]).toContain('"type":"message_stop"')
  })

  test('should not emit duplicate message_start on subsequent calls', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    const e1 = builder.build({ type: 'text-delta', delta: { text: 'a' } })
    expect(e1.some(e => e.includes('"type":"message_start"'))).toBe(true)
    
    const e2 = builder.build({ type: 'text-delta', delta: { text: 'b' } })
    expect(e2.some(e => e.includes('"type":"message_start"'))).toBe(false)
  })

  test('REGRESSION: should NOT emit duplicate content_block_delta', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // First chunk starts message and block
    const events = builder.build({
      type: 'text-delta',
      delta: { text: 'test' }
    })
    
    // index 0: message_start
    // index 1: content_block_start
    // index 2: content_block_delta
    // total should be 3
    expect(events.length).toBe(3)
    const deltas = events.filter(e => e.includes('"type":"content_block_delta"'))
    expect(deltas.length).toBe(1)
  })

  test('REGRESSION: should NOT terminate stream on usage-only chunk if stopReason is missing', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. Regular content
    builder.build({ type: 'text-delta', delta: { text: 'chunk1' } })

    // 2. Chunk with usage but NO stopReason (Gemini style intermediate status)
    const usageChunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'chunk2' },
      usage: { inputTokens: 10, outputTokens: 20 }
    }
    const events = builder.build(usageChunk)
    
    // Should contain text_delta but NOT message_stop
    expect(events.some(e => e.includes('"type":"content_block_delta"'))).toBe(true)
    expect(events.some(e => e.includes('"type":"message_stop"'))).toBe(false)
  })

  test('REGRESSION: should strictly prevent stream restart after finish', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. Initial content
    builder.build({ type: 'text-delta', delta: { text: 'start' } })

    // 2. Finish chunk
    const events1 = builder.build({
      type: 'done',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 }
    })
    expect(events1.some(e => e.includes('"type":"message_stop"'))).toBe(true)

    // 3. Subsequent chunk (e.g. Gemini sending usage again after finish)
    const events2 = builder.build({
      type: 'done',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 }
    })
    
    // Should be empty, no more message_start or message_stop
    expect(events2.length).toBe(0)
  })

  describe('flush() guarantees message_stop', () => {
    test('flush after text-only stream should emit message_stop', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      builder.build({ type: 'text-delta', delta: { text: ' world' } })
      
      const flushEvents = builder.flush()
      
      expect(flushEvents.some(e => e.includes('"type":"message_stop"'))).toBe(true)
      expect(flushEvents.some(e => e.includes('"type":"message_delta"'))).toBe(true)
      expect(flushEvents.some(e => e.includes('"stop_reason":"end_turn"'))).toBe(true)
    })

    test('flush after tool_call stream should emit message_stop with tool_use reason', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({
        type: 'tool_call',
        delta: { toolCall: { name: 'search', id: 'c1', arguments: {} } }
      })
      
      const flushEvents = builder.flush()
      
      expect(flushEvents.some(e => e.includes('"type":"message_stop"'))).toBe(true)
      expect(flushEvents.some(e => e.includes('"stop_reason":"tool_use"'))).toBe(true)
    })

    test('flush on idle builder should return empty (no message_start sent)', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      const flushEvents = builder.flush()
      
      expect(flushEvents.length).toBe(0)
    })

    test('flush after already finished stream should return empty', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      builder.build({ type: 'done', stopReason: 'end_turn' })
      
      const flushEvents = builder.flush()
      
      expect(flushEvents.length).toBe(0)
    })

    test('double flush should be idempotent', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      
      const flush1 = builder.flush()
      const flush2 = builder.flush()
      
      expect(flush1.some(e => e.includes('"type":"message_stop"'))).toBe(true)
      expect(flush2.length).toBe(0)
    })

    test('CRITICAL: abrupt stream termination still guarantees message_stop', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({ type: 'text-delta', delta: { text: 'Partial response...' } })
      
      const flushEvents = builder.flush()
      
      const hasMessageDelta = flushEvents.some(e => e.includes('"type":"message_delta"'))
      const hasMessageStop = flushEvents.some(e => e.includes('"type":"message_stop"'))
      const hasBlockStop = flushEvents.some(e => e.includes('"type":"content_block_stop"'))
      
      expect(hasBlockStop).toBe(true)
      expect(hasMessageDelta).toBe(true)
      expect(hasMessageStop).toBe(true)
    })

    test('flush after thinking block should close properly', () => {
      const builder = new AnthropicStreamingBuilder(model)
      
      builder.build({ type: 'thinking-delta', delta: { thinking: { text: 'Let me think...' } } })
      
      const flushEvents = builder.flush()
      
      expect(flushEvents.some(e => e.includes('"type":"content_block_stop"'))).toBe(true)
      expect(flushEvents.some(e => e.includes('"type":"message_stop"'))).toBe(true)
    })
  })
})
