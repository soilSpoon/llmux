import { describe, expect, it } from 'bun:test'
import {
  type ChatCompletionsResponse,
  transformResponsesRequest,
  transformToResponsesResponse,
} from '../transformer'
import type { ResponsesRequest } from '../types'

describe('transformResponsesRequest', () => {
  describe('input transformation', () => {
    it('should transform simple string input to user message', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
      }

      const result = transformResponsesRequest(request)

      expect(result.model).toBe('gpt-4o')
      expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }])
    })

    it('should transform messages array input to chat messages', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ])
    })

    it('should convert developer role to system role', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [{ role: 'developer', content: 'You are a helpful assistant' }],
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([{ role: 'system', content: 'You are a helpful assistant' }])
    })
  })

  describe('instructions transformation', () => {
    it('should add instructions as system message at the beginning', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
        instructions: 'You are helpful',
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ])
    })

    it('should prepend instructions before existing messages', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
        instructions: 'Be concise',
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ])
    })
  })

  describe('field mappings', () => {
    it('should transform max_output_tokens to max_tokens', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
        max_output_tokens: 1000,
      }

      const result = transformResponsesRequest(request)

      expect(result.max_tokens).toBe(1000)
      expect((result as unknown as Record<string, unknown>).max_output_tokens).toBeUndefined()
    })

    it('should pass through temperature field', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
        temperature: 0.7,
      }

      const result = transformResponsesRequest(request)

      expect(result.temperature).toBe(0.7)
    })

    it('should pass through top_p field', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
        top_p: 0.9,
      }

      const result = transformResponsesRequest(request)

      expect(result.top_p).toBe(0.9)
    })

    it('should pass through stream field', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
        stream: true,
      }

      const result = transformResponsesRequest(request)

      expect(result.stream).toBe(true)
    })
  })

  describe('complex transformations', () => {
    it('should handle full request with all supported fields', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'How are you?' }],
        instructions: 'You are a friendly assistant',
        stream: true,
        temperature: 0.8,
        max_output_tokens: 500,
        top_p: 0.95,
      }

      const result = transformResponsesRequest(request)

      expect(result).toEqual({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a friendly assistant' },
          { role: 'user', content: 'How are you?' },
        ],
        stream: true,
        temperature: 0.8,
        max_tokens: 500,
        top_p: 0.95,
      })
    })

    it('should only include defined fields in output', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: 'Hello',
      }

      const result = transformResponsesRequest(request)

      expect(Object.keys(result)).toEqual(['model', 'messages'])
    })
  })

  describe('content parts handling', () => {
    it('should extract text from input_text content part', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello from content part' }],
          },
        ],
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([{ role: 'user', content: 'Hello from content part' }])
    })

    it('should concatenate multiple text content parts', () => {
      const request: ResponsesRequest = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Hello' },
              { type: 'input_text', text: ' World' },
            ],
          },
        ],
      }

      const result = transformResponsesRequest(request)

      expect(result.messages).toEqual([{ role: 'user', content: 'Hello World' }])
    })
  })
})

describe('transformToResponsesResponse', () => {
  describe('content transformation', () => {
    it('should transform choices[0].message.content to output[0].content[0].text', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello, how can I help?' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.output[0]!.content[0]!.text).toBe('Hello, how can I help?')
      expect(result.output[0]!.content[0]!.type).toBe('output_text')
    })
  })

  describe('usage transformation', () => {
    it('should transform prompt_tokens to input_tokens and completion_tokens to output_tokens', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      })
    })
  })

  describe('output structure', () => {
    it('should have correct output item structure', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Test' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.output[0]!.type).toBe('message')
      expect(result.output[0]!.role).toBe('assistant')
      expect(result.output[0]!.status).toBe('completed')
      expect(result.output[0]!.id).toBeDefined()
    })
  })

  describe('metadata fields', () => {
    it('should generate correct id, object, and created_at fields', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.id).toMatch(/^resp_/)
      expect(result.object).toBe('response')
      expect(result.created_at).toBe(1700000000)
      expect(result.model).toBe('gpt-4o')
    })
  })

  describe('status mapping', () => {
    it('should map stop finish_reason to completed status', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.status).toBe('completed')
    })

    it('should map length finish_reason to incomplete status', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'length' },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.status).toBe('incomplete')
      expect(result.incomplete_details?.reason).toBe('max_output_tokens')
    })
  })

  describe('empty response handling', () => {
    it('should handle null content gracefully', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          },
        ],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.output[0]!.content[0]!.text).toBe('')
    })

    it('should handle empty choices array', () => {
      const chatResponse: ChatCompletionsResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [],
      }

      const result = transformToResponsesResponse(chatResponse)

      expect(result.output).toEqual([])
      expect(result.status).toBe('completed')
    })
  })
})
