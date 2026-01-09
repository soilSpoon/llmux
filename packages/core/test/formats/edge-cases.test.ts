import { describe, expect, it } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'

describe('Format Edge Cases', () => {
  describe('Malformed Upstream Response', () => {
    it('should throw error when critical fields are missing (OpenAI)', () => {
      const malformed = { object: 'chat.completion' } // Missing choices
      // Loose type checking in implementation might throw or return partial
      // Current implementation relies on strict types validation or runtime checks?
      // Let's see what happens.
      expect(() => OpenAIChatFormat.parseResponse(malformed)).toThrow()
    })

    it('should parse partial response if non-critical fields missing (OpenAI)', () => {
      // missing usage, model, id
      const partial = {
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      }
      const result = OpenAIChatFormat.parseResponse(partial)
      expect(result.content[0]).toBeDefined()
      expect(result.content[0]?.text).toBe('Hello')
    })

    it('should throw error when critical fields are missing (Anthropic)', () => {
        const malformed = { type: 'message' } // Missing content
        expect(() => AnthropicMessagesFormat.parseResponse(malformed)).toThrow()
    })
  })

  describe('Unsupported Features', () => {
      // Test that unsupported features are stripped or ignored safely
      it('should ignore unknown message roles in OpenAI', () => {
        const req = {
          model: 'gpt-4',
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'unknown_role', content: 'Ignored' } // Should be skipped or handled
          ],
        } as any
        // The implementation filters strictly or passes through?
        // parseRequest implementation:
        // reconstructedMessages.filter((msg) => isOpenAIMessage(msg))
        // isOpenAIMessage checks role types.

        const result = OpenAIChatFormat.parseRequest(req)
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0]).toBeDefined()
        expect(result.messages[0]?.role).toBe('user')
      })
  })
})
