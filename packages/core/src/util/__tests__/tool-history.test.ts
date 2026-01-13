import { describe, expect, it } from 'bun:test'
import type { UnifiedMessage } from '../../types/unified'
import { normalizeToolHistory } from '../tool-history'

describe('normalizeToolHistory', () => {
  it('should merge consecutive messages of the same role', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Additional context' }],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'I am an assistant' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'search', arguments: {} },
          },
        ],
      },
    ]

    const normalized = normalizeToolHistory(messages)

    // Expected:
    // 1. User message (merged text)
    // 2. Assistant message (merged text + tool call)
    // 3. User message (synthetic tool result)
    expect(normalized).toHaveLength(3)
    expect(normalized[0]!.role).toBe('user')
    expect(normalized[0]!.parts).toHaveLength(2)
    expect(normalized[0]!.parts[0]!.text).toBe('Hello')
    expect(normalized[0]!.parts[1]!.text).toBe('Additional context')

    expect(normalized[1]!.role).toBe('assistant')
    expect(normalized[1]!.parts).toHaveLength(2)
    expect(normalized[1]!.parts[0]!.text).toBe('I am an assistant')
    expect(normalized[1]!.parts[1]!.type).toBe('tool_call')

    expect(normalized[2]!.role).toBe('user')
    expect(normalized[2]!.parts[0]!.type).toBe('tool_result')
    expect(normalized[2]!.parts[0]!.toolResult?.toolCallId).toBe('call_1')
  })

  it('should handle synthetic tool results by merging them with following user messages', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_peitu8ktd', name: 'fix_bug', arguments: {} },
          },
        ],
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Analyze the result please' }],
      },
    ]

    const normalized = normalizeToolHistory(messages)

    // Expected:
    // 1. Assistant message
    // 2. User message (Synthetic result + "Analyze the result please")
    expect(normalized).toHaveLength(2)
    expect(normalized[0]!.role).toBe('assistant')

    expect(normalized[1]!.role).toBe('user')
    expect(normalized[1]!.parts).toHaveLength(2)
    expect(normalized[1]!.parts[0]!.type).toBe('tool_result')
    expect(normalized[1]!.parts[0]!.toolResult?.toolCallId).toBe('call_peitu8ktd')
    expect(normalized[1]!.parts[1]!.type).toBe('text')
    expect(normalized[1]!.parts[1]!.text).toBe('Analyze the result please')
  })

  it('should preserve alternating roles assistant -> tool(user) -> assistant', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_A', name: 'tool_a', arguments: {} },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            toolResult: { toolCallId: 'call_A', content: 'Result of A' },
          },
        ],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'I see. Now call B.' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_B', name: 'tool_b', arguments: {} },
          },
        ],
      },
    ]

    const normalized = normalizeToolHistory(messages)

    // Expected:
    // 1. Assistant (call A)
    // 2. User (result A)
    // 3. Assistant (text + call B)
    // 4. User (Synthetic result B)
    expect(normalized).toHaveLength(4)
    expect(normalized[0]!.role).toBe('assistant')
    expect(normalized[1]!.role).toBe('user')
    expect(normalized[2]!.role).toBe('assistant')
    expect(normalized[2]!.parts).toHaveLength(2)
    expect(normalized[3]!.role).toBe('user')
  })
})
