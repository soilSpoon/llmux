import { describe, expect, test } from 'bun:test'
import { AntigravityStreamingBuilder } from '../../src/providers/antigravity/streaming-builder'
import type { AntigravityBuilderState } from '../../src/providers/antigravity/streaming-builder'
import type { StreamingState } from '../../src/util/stream-normalizer'

function createBuilder(model = 'claude-3-opus-20240229') {
  const state: AntigravityBuilderState = {
    messageStartGenerated: false,
    messageStartFiltered: false,
    currentBlockType: null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    finishReason: null,
    finalUsage: null,
    messageStopEmitted: false,
    streamingState: {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    } as StreamingState,
  }
  return new AntigravityStreamingBuilder(state, model)
}

describe('AntigravityStreamingBuilder TDD', () => {
  test('should close thinking block when finish event is received with end_turn', () => {
    const builder = createBuilder()
    
    // 1. Start thinking
    builder.build({
      type: 'thinking-delta',
      delta: { thinking: { text: "I'm thinking..." } }
    })
    
    // 2. Finish directly
    const finishEvents = builder.build({
      type: 'finish',
      finishReason: { raw: 'end_turn', unified: 'end_turn' },
      usage: { inputTokens: 10, outputTokens: 20 }
    })
    
    const events = (Array.isArray(finishEvents) ? finishEvents : finishEvents ? [finishEvents] : []) as string[]
    
    const blockStopIndex = events.findIndex(e => e.includes('"type":"content_block_stop"'))
    const msgDeltaIndex = events.findIndex(e => e.includes('"type":"message_delta"'))
    const msgStopIndex = events.findIndex(e => e.includes('"type":"message_stop"'))
    
    expect(events.length).toBeGreaterThan(0)
    expect(blockStopIndex).not.toBe(-1) // Should have block stop
    expect(msgDeltaIndex).not.toBe(-1) // Should have message delta
    expect(msgStopIndex).not.toBe(-1) // Should have message stop
    
    // Order matters
    expect(blockStopIndex).toBeLessThan(msgDeltaIndex)
    expect(msgDeltaIndex).toBeLessThan(msgStopIndex)
  })

  test('should close text block when finish event is received', () => {
    const builder = createBuilder()
    
    builder.build({
      type: 'text-delta',
      delta: { text: "Hello" }
    })
    
    const finishEvents = builder.build({
      type: 'finish',
      finishReason: { raw: 'end_turn', unified: 'end_turn' },
      usage: { inputTokens: 5, outputTokens: 5 }
    })
    
    const events = (Array.isArray(finishEvents) ? finishEvents : finishEvents ? [finishEvents] : []) as string[]
    
    const blockStopIndex = events.findIndex(e => e.includes('"type":"content_block_stop"'))
    const msgStopIndex = events.findIndex(e => e.includes('"type":"message_stop"'))
    
    expect(blockStopIndex).not.toBe(-1)
    expect(msgStopIndex).not.toBe(-1)
    expect(blockStopIndex).toBeLessThan(msgStopIndex)
  })

  test('should handle flush correctly with open blocks', () => {
    const builder = createBuilder()
    
    builder.build({
      type: 'thinking-delta',
      delta: { thinking: { text: "Unfinished thought" } }
    })
    
    // No finish event, just flush
    const flushResult = builder.flush()
    const output = flushResult || ''
    
    expect(output).toContain('"type":"content_block_stop"')
    expect(output).toContain('"type":"message_stop"')
    
    // Order check (regex or indexOf)
    const stopIdx = output.indexOf('"type":"content_block_stop"')
    const msgStopIdx = output.indexOf('"type":"message_stop"')
    
    expect(stopIdx).not.toBe(-1)
    expect(msgStopIdx).not.toBe(-1)
    expect(stopIdx).toBeLessThan(msgStopIdx)
  })
})
