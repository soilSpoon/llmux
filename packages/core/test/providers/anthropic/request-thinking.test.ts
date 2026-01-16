import { describe, expect, it } from 'bun:test'
import type { UnifiedRequest } from '../../../src/types/unified'
import { transform } from '../../../src/providers/anthropic/request'

describe('Anthropic Request Transform - Thinking Preservation', () => {
  it('should preserve thinking blocks in conversation history', () => {
    const request: UnifiedRequest = {
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        },
        {
          role: 'assistant',
          parts: [
            {
              type: 'thinking',
              thinking: { text: 'I should greet the user', signature: 'sig123' },
            },
            { type: 'text', text: 'Hi there!' },
          ],
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'How are you?' }],
        },
      ],
      config: { maxTokens: 100 },
      metadata: { model: 'claude-3-opus-20240229' },
    }

    const result = transform(request)

    // Verify messages length is preserved
    expect(result.messages).toHaveLength(3)

    // Verify user message is unchanged
    expect(result.messages[0]!.content).toEqual([
      { type: 'text', text: 'Hello' },
    ])

    // Verify assistant message has thinking preserved
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.content).toHaveLength(2)
    expect(result.messages[1]!.content[0]).toEqual({
      type: 'thinking',
      thinking: 'I should greet the user',
      signature: 'sig123',
    })
    expect(result.messages[1]!.content[1]).toEqual({
      type: 'text',
      text: 'Hi there!',
    })

    // Verify last user message is unchanged
    expect(result.messages[2]!.content).toEqual([
      { type: 'text', text: 'How are you?' },
    ])
  })

  it('should preserve thinking parts alongside text', () => {
    const request: UnifiedRequest = {
      messages: [
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Part 1' },
            {
              type: 'thinking',
              thinking: { text: 'Thinking...', signature: 'sig' },
            },
            { type: 'text', text: 'Part 2' },
          ],
        },
      ],
      metadata: { model: 'claude-3-opus-20240229' },
    }

    const result = transform(request)

    expect(result.messages[0]!.content).toHaveLength(3)
    expect(result.messages[0]!.content[0]).toEqual({ type: 'text', text: 'Part 1' })
    expect(result.messages[0]!.content[1]).toEqual({
      type: 'thinking',
      thinking: 'Thinking...',
      signature: 'sig',
    })
    expect(result.messages[0]!.content[2]).toEqual({ type: 'text', text: 'Part 2' })
  })

  it('should preserve messages with only thinking blocks', () => {
    const request: UnifiedRequest = {
      messages: [
        {
          role: 'assistant',
          parts: [
            {
              type: 'thinking',
              thinking: { text: 'Just thinking...', signature: 'sig' },
            },
          ],
        },
      ],
      metadata: { model: 'claude-3-opus-20240229' },
    }

    const result = transform(request)

    expect(result.messages[0]!.content).toHaveLength(1)
    expect(result.messages[0]!.content[0]).toEqual({
      type: 'thinking',
      thinking: 'Just thinking...',
      signature: 'sig',
    })
  })
})
