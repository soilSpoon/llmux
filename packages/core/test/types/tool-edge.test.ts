import { describe, expect, it } from 'bun:test'
import { validateToolEdges, linearizeForClaude } from '../../src/types/tool-edge.js'
import type { ToolCallEdge, ToolResultEdge } from '../../src/types/tool-edge.js'
import type { UnifiedMessage } from '../../src/types/unified.js'

describe('ToolEdgeGraph', () => {
  it('should validate tool edges', () => {
    const calls: ToolCallEdge[] = [{ id: 'call1', name: 'test', arguments: {}, issuedAtMessageIndex: 0 }]
    const results: ToolResultEdge[] = [
      { toolCallId: 'call1', content: 'ok', status: 'success', producedAtMessageIndex: 1 },
    ]

    expect(validateToolEdges(calls, results)).toHaveLength(0)
  })

  it('should find orphaned tool results', () => {
    const calls: ToolCallEdge[] = []
    const results: ToolResultEdge[] = [
      { toolCallId: 'call1', content: 'ok', status: 'success', producedAtMessageIndex: 1 },
    ]

    const errors = validateToolEdges(calls, results)
    expect(errors).toContain('Orphaned tool result found for call ID: call1')
  })

  it('should linearize for Claude (strict adjacency)', () => {
    const messages: UnifiedMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_call', toolCall: { id: 'c1', name: 't1', arguments: {} } },
        ],
      },
      { role: 'user', parts: [{ type: 'text', text: 'wait' }] },
      {
        role: 'tool',
        parts: [{ type: 'tool_result', toolResult: { toolCallId: 'c1', content: 'res' } }],
      },
    ]

    const linearized = linearizeForClaude(messages)

    const msg1 = linearized[1]
    expect(msg1).toBeDefined()
    expect(msg1?.role).toBe('assistant')

    const msg2 = linearized[2]
    expect(msg2).toBeDefined()
    expect(msg2?.role).toBe('user')

    const part2 = msg2?.parts[0]
    expect(part2).toBeDefined()
    expect(part2?.type).toBe('tool_result')

    const msg3 = linearized[3]
    expect(msg3).toBeDefined()
    expect(msg3?.parts[0]?.text).toBe('wait')
  })
})
