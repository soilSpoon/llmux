import { describe, expect, it } from 'bun:test'
import type { UnifiedRequest } from '../../../src/types/unified'
import { transform } from '../../../src/providers/anthropic/request'

describe('Anthropic Request Transform - Thinking Stripping', () => {
  it('should strip thinking blocks from conversation history', () => {
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

    // Verify assistant message has thinking stripped
    expect(result.messages[1]!.role).toBe('assistant')
    expect(result.messages[1]!.content).toHaveLength(1) // Only text part remains
    expect(result.messages[1]!.content[0]).toEqual({
      type: 'text',
      text: 'Hi there!',
    })

    // Verify last user message is unchanged
    expect(result.messages[2]!.content).toEqual([
      { type: 'text', text: 'How are you?' },
    ])
  })

  it('should preserve text parts even if thinking is present', () => {
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

    expect(result.messages[0]!.content).toHaveLength(2)
    expect(result.messages[0]!.content[0]).toEqual({ type: 'text', text: 'Part 1' })
    expect(result.messages[0]!.content[1]).toEqual({ type: 'text', text: 'Part 2' })
  })

  it('should handle messages with only thinking blocks (result in empty content)', () => {
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

    // Anthropic API might reject empty content, but transform should strip it correctly
    // It is up to the caller or validation layer to ensure messages are not empty if required
    expect(result.messages[0]!.content).toHaveLength(0)
  })
})
