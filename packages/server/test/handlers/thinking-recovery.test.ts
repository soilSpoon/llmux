import { describe, expect, it } from 'bun:test'
import { looksLikeCompactedThinkingTurn } from '../../src/handlers/thinking-recovery'
import type { ConversationMessage } from '../../src/handlers/types/thinking-types'

describe('Thinking Recovery > compacted thinking detection', () => {
  it('should detect compacted thinking in Gemini format (no text before tool)', () => {
    const msg: ConversationMessage = {
      role: 'model',
      parts: [
        { functionCall: { name: 'test', args: {} } }
      ]
    }
    // No text, has function call, no thinking -> Compacted
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(true)
  })

  it('should detect compacted thinking in Gemini format (tool use after tool use)', () => {
      const msg: ConversationMessage = {
        role: 'model',
        parts: [
          { functionCall: { name: 'test1', args: {} } },
          { functionCall: { name: 'test2', args: {} } }
        ]
      }
      expect(looksLikeCompactedThinkingTurn(msg)).toBe(true)
    })

  it('should NOT detect compacted thinking if there is text before tool (Gemini)', () => {
    const msg: ConversationMessage = {
      role: 'model',
      parts: [
        { text: 'Here is some thought process...' },
        { functionCall: { name: 'test', args: {} } }
      ]
    }
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it('should NOT detect compacted thinking if there is explicit thinking (Gemini)', () => {
      const msg: ConversationMessage = {
          role: 'model',
          parts: [
            { text: 'thinking...', thought: true },
            { functionCall: { name: 'test', args: {} } }
          ]
        }
        expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it('should detect compacted thinking in Anthropic format (no text before tool)', () => {
    const msg: ConversationMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: '1', name: 'test', input: {} }
      ]
    }
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(true)
  })

  it('should NOT detect compacted thinking if text before tool (Anthropic)', () => {
    const msg: ConversationMessage = {
      role: 'assistant',
      content: [
          { type: 'text', text: 'Some reasoning' },
        { type: 'tool_use', id: '1', name: 'test', input: {} }
      ]
    }
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
  })

  it('should NOT detect compacted thinking if thinking block exists (Anthropic)', () => {
      const msg: ConversationMessage = {
        role: 'assistant',
        content: [
            { type: 'thinking', signature: 'sig', thinking: 'thought' },
          { type: 'tool_use', id: '1', name: 'test', input: {} }
        ]
      }
      expect(looksLikeCompactedThinkingTurn(msg)).toBe(false)
    })
})
