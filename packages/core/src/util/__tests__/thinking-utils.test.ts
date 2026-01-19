import { describe, expect, it } from 'bun:test'
import type { UnifiedMessage } from '../../types/unified'
import { stripThinkingFromMessages } from '../thinking-utils'

describe('stripThinkingFromMessages', () => {
  it('should remove thinking blocks from messages', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', thinking: { text: 'Thinking...' } },
          { type: 'text', text: 'Hi there' },
        ],
      },
    ]

    const stripped = stripThinkingFromMessages(messages)

    expect(stripped).toHaveLength(2)
    expect(stripped[0]!.parts).toHaveLength(1)
    expect(stripped[0]!.parts[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(stripped[1]!.parts).toHaveLength(1)
    expect(stripped[1]!.parts[0]).toEqual({ type: 'text', text: 'Hi there' })
  })

  it('should preserve other content types', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', thinking: { text: 'Thinking...' } },
          { type: 'tool_call', toolCall: { id: '1', name: 'tool', arguments: {} } },
          { type: 'text', text: 'Using tool' },
        ],
      },
    ]

    const stripped = stripThinkingFromMessages(messages)

    expect(stripped[0]!.parts).toHaveLength(2)
    expect(stripped[0]!.parts[0]!.type).toBe('tool_call')
    expect(stripped[0]!.parts[1]!.type).toBe('text')
  })

  it('should handle multi-turn conversations', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Q1' }],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', thinking: { text: 'T1' } },
          { type: 'text', text: 'A1' },
        ],
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Q2' }],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', thinking: { text: 'T2' } },
          { type: 'text', text: 'A2' },
        ],
      },
    ]

    const stripped = stripThinkingFromMessages(messages)

    expect(stripped).toHaveLength(4)
    expect(stripped.every((m) => m.parts.every((p) => p.type !== 'thinking'))).toBe(true)
    expect(stripped[1]!.parts).toHaveLength(1)
    expect(stripped[1]!.parts[0]!.text).toBe('A1')
    expect(stripped[3]!.parts).toHaveLength(1)
    expect(stripped[3]!.parts[0]!.text).toBe('A2')
  })

  it('should return empty parts array if message only contained thinking', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'thinking', thinking: { text: 'Just thinking' } }],
      },
    ]

    const stripped = stripThinkingFromMessages(messages)

    expect(stripped[0]!.parts).toHaveLength(0)
  })

  it('should not mutate original messages', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', thinking: { text: 'Thinking...' } },
          { type: 'text', text: 'Hi' },
        ],
      },
    ]

    const stripped = stripThinkingFromMessages(messages)

    expect(stripped[0]!.parts).toHaveLength(1)
    expect(messages[0]!.parts).toHaveLength(2)
  })
})
