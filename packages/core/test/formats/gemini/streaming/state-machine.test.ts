import { describe, expect, it } from 'bun:test'
import { StreamingStateMachine, type StreamEvent } from '../../../../src/formats/gemini/streaming/state-machine'

describe('StreamingStateMachine', () => {
  it('should handle simple text streaming', () => {
    const machine = new StreamingStateMachine()
    const events: StreamEvent[] = [
      { type: 'content', text: 'Hello' },
      { type: 'content', text: ' World' },
      { type: 'done' }
    ]

    const chunks = events.flatMap(e => machine.process(e))
    
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' World' },
      { type: 'finish', reason: 'stop' }
    ])
  })

  it('should handle thinking block followed by text', () => {
    const machine = new StreamingStateMachine()
    const events: StreamEvent[] = [
      { type: 'thought', text: 'Hmm', signature: 'sig1' },
      { type: 'thought', text: '...' }, // continuation
      { type: 'content', text: 'Answer' },
      { type: 'done' }
    ]

    const chunks = events.flatMap(e => machine.process(e))

    // State machine should emit thinking deltas then text deltas
    expect(chunks).toEqual([
      { type: 'thinking-delta', text: 'Hmm' }, // signature might be handled in start or first chunk
      { type: 'thinking-delta', text: '...' },
      { type: 'text-delta', text: 'Answer' },
      { type: 'finish', reason: 'stop' }
    ])
  })

  it('should handle tool calls', () => {
    const machine = new StreamingStateMachine()
    const events: StreamEvent[] = [
      { type: 'tool_call', id: 'call1', name: 'search', args: '{"q":' },
      { type: 'tool_call', args: '"bun"}' },
      { type: 'done' }
    ]

    const chunks = events.flatMap(e => machine.process(e))
    
    // Some state machines accumulate tool args and emit one tool call at the end, 
    // or emit deltas? 
    // PRD Goal: "Streaming events safely". UnifiedResponse usually creates one tool call item.
    // However, for streaming, we might emit deltas or full call on completion.
    // Let's assume full call emission for simplicity or deltas if supported.
    // UnifiedStreamChunk supports tool_call (full) usually? Or tool_call_delta?
    // Let's assume this machine buffers tool calls and emits 'tool_call' chunk when complete or on transition?
    // Actually, gemini streams tool calls as one part usually.
    
    // Let's assume machine emits accumulated tool call at the end of tool sequence
    expect(chunks).toEqual([
       { 
           type: 'tool_call', 
           toolCall: { id: 'call1', name: 'search', arguments: { q: 'bun' } } 
       },
       { type: 'finish', reason: 'tool_calls' }
    ])
  })
})
