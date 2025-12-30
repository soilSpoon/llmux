import { describe, expect, it } from 'bun:test'
import {
  transformToResponsesResponse,
  transformResponsesRequest,
  type ResponsesRequest,
  type ChatCompletionsResponse,
} from '@llmux/core'

/**
 * Phase 5: Response Transformation Tests
 */
describe('Responses API Transformation', () => {
  describe('transformResponsesRequest', () => {
    it('should transform simple input to messages', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4',
        input: [{ role: 'user', content: 'Hello' }],
      }

      const result = transformResponsesRequest(request)

      expect(result.model).toBe('gpt-4')
      expect(result.messages).toHaveLength(1)
      const msg0 = result.messages[0]
      if (!msg0) throw new Error('Expected message')
      expect(msg0.role).toBe('user')
    })

    it('should transform string input to user message', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4',
        input: 'Hello world',
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toHaveLength(1)
      const msg0 = result.messages[0]
      if (!msg0) throw new Error('Expected message')
      expect(msg0.content).toBe('Hello world')
    })

    it('should include instructions as system message', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4',
        input: [{ role: 'user', content: 'Hello' }],
        instructions: 'Be helpful and concise',
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toHaveLength(2)
      const msg0 = result.messages[0]
      const msg1 = result.messages[1]
      if (!msg0 || !msg1) throw new Error('Expected messages')
      expect(msg0.role).toBe('system')
      expect(msg0.content).toBe('Be helpful and concise')
    })

    it('should map max_output_tokens to max_tokens', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4',
        input: 'Hello',
        max_output_tokens: 1000,
      }

      const result = transformResponsesRequest(request)

      expect(result.max_tokens).toBe(1000)
    })

    it('should preserve temperature', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4',
        input: 'Hello',
        temperature: 0.7,
      }

      const result = transformResponsesRequest(request)

      expect(result.temperature).toBe(0.7)
    })

    // Note: Tool transformation not yet implemented in transformResponsesRequest
  })

  describe('transformToResponsesResponse', () => {
    it('should transform simple text response', () => {
      const response: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      const result = transformToResponsesResponse(response)

      expect(result.id).toMatch(/^resp_/)
      expect(result.output).toHaveLength(1)
      const output0 = result.output?.[0]
      if (!output0) throw new Error('Expected output')
      expect(output0.type).toBe('message')
    })

    it('should include usage information', () => {
      const response: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      const result = transformToResponsesResponse(response)

      expect(result.usage).toBeDefined()
      expect(result.usage?.input_tokens).toBe(10)
      expect(result.usage?.output_tokens).toBe(5)
    })

    it('should handle empty content gracefully', () => {
      const response: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = transformToResponsesResponse(response)

      expect(result.id).toMatch(/^resp_/)
      expect(result.output).toBeDefined()
    })
  })

  describe('round-trip transformation', () => {
    it('should preserve content through request-response cycle', () => {
      const originalRequest: ResponsesRequest = {
        model: 'gpt-4',
        input: [{ role: 'user', content: 'What is 2+2?' }],
        instructions: 'Be concise',
      }

      const chatRequest = transformResponsesRequest(originalRequest)

      expect(chatRequest.model).toBe('gpt-4')
      expect(chatRequest.messages).toHaveLength(2)
      const msg0 = chatRequest.messages[0]
      const msg1 = chatRequest.messages[1]
      if (!msg0 || !msg1) throw new Error('Expected messages')
      expect(msg0.role).toBe('system')
      expect(msg1.role).toBe('user')

      const chatResponse: ChatCompletionsResponse = {
        id: 'resp-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '4' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
      }

      const responsesResponse = transformToResponsesResponse(chatResponse)

      expect(responsesResponse.output).toHaveLength(1)
      const output0 = responsesResponse.output?.[0]
      if (!output0) throw new Error('Expected output')
      expect(output0.type).toBe('message')
    })
  })
})
