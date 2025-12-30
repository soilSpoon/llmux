import { describe, expect, it } from 'bun:test'
import { detectOpenAIApiFormat } from '../format-detector'

describe('detectOpenAIApiFormat', () => {
  describe('Responses API detection', () => {
    it('should detect Responses API format when request has "input" field only', () => {
      const request = { model: 'gpt-4', input: [{ role: 'user', content: 'Hello' }] }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect Responses API format when request has string input', () => {
      const request = { model: 'gpt-4', input: 'Hello world' }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect Responses API by "instructions" field', () => {
      const request = { model: 'gpt-4', input: 'Hello', instructions: 'Be helpful' }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect Responses API by "max_output_tokens" field', () => {
      const request = { model: 'gpt-4', input: 'Hello', max_output_tokens: 1000 }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect Responses API by "previous_response_id" field', () => {
      const request = { model: 'gpt-4', input: 'Continue', previous_response_id: 'resp_123' }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect Responses API by "reasoning" field', () => {
      const request = { model: 'gpt-4', input: 'Think about this', reasoning: { effort: 'medium' } }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })
  })

  describe('Chat Completions API detection', () => {
    it('should detect Chat Completions format when request has "messages" field', () => {
      const request = { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }
      expect(detectOpenAIApiFormat(request)).toBe('completions')
    })

    it('should detect Chat Completions by "max_tokens" field', () => {
      const request = { model: 'gpt-4', messages: [], max_tokens: 1000 }
      expect(detectOpenAIApiFormat(request)).toBe('completions')
    })

    it('should detect Chat Completions by "frequency_penalty" field', () => {
      const request = { model: 'gpt-4', messages: [], frequency_penalty: 0.5 }
      expect(detectOpenAIApiFormat(request)).toBe('completions')
    })
  })

  describe('Edge cases', () => {
    it('should default to completions for empty object', () => {
      expect(detectOpenAIApiFormat({})).toBe('completions')
    })

    it('should default to completions for null', () => {
      expect(detectOpenAIApiFormat(null)).toBe('completions')
    })

    it('should default to completions for undefined', () => {
      expect(detectOpenAIApiFormat(undefined)).toBe('completions')
    })

    it('should prefer responses when both "input" and "messages" present', () => {
      // This is an edge case - if both are present, "input" takes priority
      const request = { model: 'gpt-4', input: 'Hello', messages: [] }
      expect(detectOpenAIApiFormat(request)).toBe('responses')
    })

    it('should detect completions when only model is present', () => {
      const request = { model: 'gpt-4' }
      expect(detectOpenAIApiFormat(request)).toBe('completions')
    })
  })
})
