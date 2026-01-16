import { describe, test, expect } from 'bun:test'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'

describe('Anthropic Messages Format Extended', () => {
  describe('Thinking Config Inference', () => {
    test('should infer thinking config from model name if not explicitly provided', () => {
      const requestWithThinkingModel = {
        model: 'claude-3-5-sonnet-thinking-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 20000,
      }

      const unified = AnthropicMessagesFormat.parseRequest(requestWithThinkingModel)

      expect(unified.thinking).toBeDefined()
      expect(unified.thinking?.enabled).toBe(true)
      // Since max_tokens (20000) > 16384, budget should be 16384
      expect(unified.thinking?.budget).toBe(16384)
    })

    test('should use lower default budget if max_tokens is small', () => {
      const requestWithThinkingModel = {
        model: 'claude-3-5-sonnet-thinking-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 8000,
      }

      const unified = AnthropicMessagesFormat.parseRequest(requestWithThinkingModel)

      expect(unified.thinking).toBeDefined()
      expect(unified.thinking?.enabled).toBe(true)
      // Since max_tokens (8000) <= 16384, budget should be 8192 (default fallback)
      expect(unified.thinking?.budget).toBe(8192)
    })

    test('should NOT infer thinking if model name does not contain thinking', () => {
      const requestNormal = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 4096,
      }

      const unified = AnthropicMessagesFormat.parseRequest(requestNormal)

      expect(unified.thinking).toBeUndefined()
    })
  })
})
