import { describe, it, expect } from 'bun:test'
import { normalizeToolHistory } from '../../src/util/tool-history'
import { UnifiedMessage } from '../../src/types/unified'

describe('tool-history normalization regression', () => {
  it('should inject synthetic results when assistant chat message breaks tool call sequence', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'test_tool', arguments: {} }
          }
        ]
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'thinking about it...' }]
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            toolResult: { toolCallId: 'call_1', content: 'result', isError: false }
          }
        ]
      }
    ]

    const normalized = normalizeToolHistory(messages)

    // Expected (New Merged Behavior):
    // 0: assistant (tool_call: call_1 + text: thinking about it...)
    // 1: user (tool_result: call_1) <- original
    //
    // Previously it would inject a synthetic result between assistants,
    // but now it merges consecutive assistants, which is cleaner and valid.
    
    expect(normalized).toHaveLength(2)
    const msg0 = normalized[0]
    expect(msg0).toBeDefined()
    expect(msg0!.role).toBe('assistant')
    expect(msg0!.parts).toHaveLength(2)
    
    const msg1 = normalized[1]
    expect(msg1).toBeDefined()
    expect(msg1!.role).toBe('user')
    expect(msg1!.parts.some(p => p.type === 'tool_result' && p.toolResult?.toolCallId === 'call_1')).toBe(true)
  })
})
