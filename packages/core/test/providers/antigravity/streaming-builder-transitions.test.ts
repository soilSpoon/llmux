import { describe, expect, it } from 'bun:test'
import { AntigravityStreamingBuilder } from '../../../src/providers/antigravity/streaming-builder'
import type { AntigravityBuilderState } from '../../../src/providers/antigravity/streaming-builder'
import type { StreamChunk } from '../../../src/types/unified'

describe('AntigravityStreamingBuilder - Block Transitions', () => {
  const createMockState = (): AntigravityBuilderState => ({
    messageStartGenerated: true,
    currentBlockType: null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    finishReason: null,
    finalUsage: null,
    messageStopEmitted: false,
    messageStartFiltered: false,
    streamingState: {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    },
  })

  it('should verify transition from text to thinking', () => {
    const builder = new AntigravityStreamingBuilder(createMockState(), 'test-model')
    
    const textChunk: StreamChunk = {
      type: 'text-delta',
      delta: { text: 'Hello' }
    }
    
    const textEvents = builder.build(textChunk)
    if (!textEvents) throw new Error('Expected text events')
    const textOutput = Array.isArray(textEvents) ? textEvents.join('') : textEvents
    
    expect(textOutput).toContain('event: content_block_start')
    expect(textOutput).toContain('"type":"text"')
    expect(textOutput).toContain('"index":0')
    expect(textOutput).toContain('event: content_block_delta')
    expect(textOutput).toContain('"text":"Hello"')

    const thinkingChunk: StreamChunk = {
      type: 'thinking-delta',
      delta: { thinking: { text: 'Thinking...' } }
    }
    
    const thinkingEvents = builder.build(thinkingChunk)
    if (!thinkingEvents) throw new Error('Expected thinking events')
    const thinkingOutput = Array.isArray(thinkingEvents) ? thinkingEvents.join('') : thinkingEvents
    
    expect(thinkingOutput).toContain('event: content_block_stop')
    expect(thinkingOutput).toContain('"index":0')
    
    expect(thinkingOutput).toContain('event: content_block_start')
    expect(thinkingOutput).toContain('"type":"thinking"')
    expect(thinkingOutput).toContain('"index":1')
    
    expect(thinkingOutput).toContain('event: content_block_delta')
    expect(thinkingOutput).toContain('"type":"thinking_delta"')
    expect(thinkingOutput).toContain('"thinking":"Thinking..."')
    expect(thinkingOutput).toContain('"index":1')
    
    const stopIndex = thinkingOutput.indexOf('event: content_block_stop')
    const startIndex = thinkingOutput.indexOf('event: content_block_start')
    const deltaIndex = thinkingOutput.indexOf('event: content_block_delta')
    
    expect(stopIndex).toBeLessThan(startIndex)
    expect(startIndex).toBeLessThan(deltaIndex)
  })

  it('should verify transition from thinking to text', () => {
    const state = createMockState()
    state.currentBlockType = 'thinking'
    state.currentBlockIndex = 0
    
    const builder = new AntigravityStreamingBuilder(state, 'test-model')
    
    const textChunk: StreamChunk = {
      type: 'text-delta',
      delta: { text: 'Answer' }
    }
    
    const events = builder.build(textChunk)
    if (!events) throw new Error('Expected events')
    const output = Array.isArray(events) ? events.join('') : events
    
    expect(output).toContain('event: content_block_stop')
    expect(output).toContain('"index":0')
    
    expect(output).toContain('event: content_block_start')
    expect(output).toContain('"type":"text"')
    expect(output).toContain('"index":1')
    
    expect(output).toContain('event: content_block_delta')
    expect(output).toContain('"text":"Answer"')
    expect(output).toContain('"index":1')
  })
})
