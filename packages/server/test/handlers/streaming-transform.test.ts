import { describe, expect, test } from 'bun:test'
import { transformStreamChunk } from '../../src/handlers/streaming'

describe('transformStreamChunk', () => {
  describe('OpenAI to Anthropic', () => {
    test('transforms OpenAI delta to Anthropic content_block_delta', () => {
      const openaiChunk =
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n'

      const result = transformStreamChunk(openaiChunk, 'openai', 'anthropic')

      expect(result).toContain('data:')
      expect(result).toContain('content_block_delta')
    })

    test('handles [DONE] message', () => {
      const doneChunk = 'data: [DONE]\n'

      const result = transformStreamChunk(doneChunk, 'openai', 'anthropic')

      expect(result).toContain('data: [DONE]')
    })
  })

  describe('Anthropic to OpenAI', () => {
    test('transforms Anthropic delta to OpenAI format', () => {
      const anthropicChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"World"}}\n'

      const result = transformStreamChunk(anthropicChunk, 'anthropic', 'openai')

      expect(result).toContain('data:')
      expect(result).toContain('chat.completion.chunk')
    })
  })

  describe('Gemini to OpenAI', () => {
    test('transforms Gemini candidate to OpenAI format', () => {
      const geminiChunk =
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}\n'

      const result = transformStreamChunk(geminiChunk, 'gemini', 'openai')

      expect(result).toContain('data:')
      expect(result).toContain('chat.completion.chunk')
    })
  })

  describe('Same format passthrough', () => {
    test('returns chunk unchanged when same format', () => {
      const chunk = 'data: {"test":"value"}\n'

      const result = transformStreamChunk(chunk, 'openai', 'openai')

      expect(result).toBe(chunk)
    })
  })

  describe('Error handling', () => {
    test('returns original chunk on parse error', () => {
      const invalidChunk = 'data: {invalid json}\n'

      const result = transformStreamChunk(invalidChunk, 'openai', 'anthropic')

      expect(result).toBe(invalidChunk)
    })

    test('handles empty lines gracefully', () => {
      const emptyChunk = '\n\n'

      const result = transformStreamChunk(emptyChunk, 'openai', 'anthropic')

      expect(result).toBe('\n')
    })
  })

  describe('Format variations', () => {
    test('transforms to Gemini format', () => {
      const openaiChunk =
        'data: {"choices":[{"delta":{"content":"Test"}}]}\n'

      const result = transformStreamChunk(openaiChunk, 'openai', 'gemini')

      expect(result).toContain('candidates')
    })

    test('handles finish_reason in transformation', () => {
      const openaiChunk =
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n'

      const result = transformStreamChunk(openaiChunk, 'openai', 'anthropic')

      expect(result).toContain('data:')
    })
  })
})
