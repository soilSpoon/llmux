import { describe, expect, it } from 'bun:test'
import { recoverToolIds } from '../../src/util/tool-id-recovery'
import type { UnifiedMessage } from '../../src/types/unified'

describe('ToolIdRecovery', () => {
  it('should keep matching IDs as is', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { id: 'correct_id', name: 'func', arguments: {} } }]
      },
      {
        role: 'tool',
        parts: [{ type: 'tool_result', toolResult: { toolCallId: 'correct_id', content: 'ok' } }]
      }
    ]

    const result = recoverToolIds(input)
    expect((result[1]!.parts[0] as any).toolResult.toolCallId).toBe('correct_id')
  })

  it('should recover orphaned result ID by available call ID', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { id: 'call_real', name: 'func', arguments: {} } }]
      },
      {
        role: 'tool',
        parts: [{ type: 'tool_result', toolResult: { toolCallId: 'wrong_id', content: 'ok' } }]
      }
    ]

    const result = recoverToolIds(input)
    // Should rematch 'wrong_id' to 'call_real' because it's the only available unmatched call
    expect((result[1]!.parts[0] as any).toolResult.toolCallId).toBe('call_real')
  })

  it('should handle multiple orphans sequentially', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
            { type: 'tool_call', toolCall: { id: 'call_1', name: 'func1', arguments: {} } },
            { type: 'tool_call', toolCall: { id: 'call_2', name: 'func2', arguments: {} } }
        ]
      },
      {
        role: 'tool',
        parts: [
            { type: 'tool_result', toolResult: { toolCallId: 'wrong_a', content: 'res1' } },
            { type: 'tool_result', toolResult: { toolCallId: 'wrong_b', content: 'res2' } }
        ]
      }
    ]

    const result = recoverToolIds(input)
    const res1 = (result[1]!.parts[0] as any).toolResult
    const res2 = (result[1]!.parts[1] as any).toolResult

    // Set order is technically not guaranteed in JS spec for iteration but practically insertion order.
    // map.keys() returns iterator.
    // We expect call_1 then call_2
    expect([res1.toolCallId, res2.toolCallId]).toContain('call_1')
    expect([res1.toolCallId, res2.toolCallId]).toContain('call_2')
    expect(res1.toolCallId).not.toBe(res2.toolCallId)
  })
})
