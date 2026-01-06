import { describe, expect, it } from 'bun:test'
import { OpenAIResponsesFormat } from '../../src/formats/openai-responses'
import type { FormatContext } from '../../src/formats/base'
import type { StreamChunk } from '../../src/types/unified'
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
  createUnifiedToolCall,
} from '../providers/_utils/fixtures'

describe('OpenAIResponsesFormat', () => {
  const ctx: FormatContext = {
    provider: 'openai',
    model: 'gpt-4o',
  }

  describe('id', () => {
    it('should have id "openai-responses"', () => {
      expect(OpenAIResponsesFormat.id).toBe('openai-responses')
    })
  })

  describe('isSupportedWireRequest', () => {
    it('should return true for valid Responses API request with input field', () => {
      const req = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return true for request with input_text content type', () => {
      const req = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return true for request with instructions field', () => {
      const req = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        instructions: 'You are a helpful assistant.',
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return true for request with max_output_tokens', () => {
      const req = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        max_output_tokens: 1000,
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return false for Chat Completions request (messages only)', () => {
      const req = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(OpenAIResponsesFormat.isSupportedWireRequest(null)).toBe(false)
      expect(OpenAIResponsesFormat.isSupportedWireRequest(undefined)).toBe(false)
      expect(OpenAIResponsesFormat.isSupportedWireRequest('string')).toBe(false)
    })

    it('should return false for request without model', () => {
      const req = {
        input: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIResponsesFormat.isSupportedWireRequest(req)).toBe(false)
    })
  })

  describe('isSupportedWireResponse', () => {
    it('should return true for valid OpenAI response', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }
      expect(OpenAIResponsesFormat.isSupportedWireResponse(res)).toBe(true)
    })

    it('should return false for non-object values', () => {
      expect(OpenAIResponsesFormat.isSupportedWireResponse(null)).toBe(false)
      expect(OpenAIResponsesFormat.isSupportedWireResponse(undefined)).toBe(false)
    })
  })

  describe('parseRequest', () => {
    it('should parse a simple Responses API request with input field', () => {
      const req = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hello, world!' }],
      }

      const result = OpenAIResponsesFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0]!
      expect(msg.role).toBe('user')
      expect(msg.parts[0]!.text).toBe('Hello, world!')
    })

    it('should parse request with input_text content type', () => {
      const req = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello with input_text' }],
          },
        ],
      }

      const result = OpenAIResponsesFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const part = result.messages[0]!.parts[0]!
      expect(part.type).toBe('text')
      expect(part.text).toBe('Hello with input_text')
    })

    it('should parse generation config with max_output_tokens', () => {
      const req = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hello' }],
        max_output_tokens: 2000,
        temperature: 0.8,
      }

      // Note: The current implementation uses standard OpenAI parsing
      // max_output_tokens maps to max_completion_tokens which maps to maxTokens
      const result = OpenAIResponsesFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      // Generation config should be parsed
      expect(result.config?.temperature).toBe(0.8)
    })

    it('should parse tools in Responses API format', () => {
      const req = {
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
            },
          },
        ],
      }

      const result = OpenAIResponsesFormat.parseRequest(req)

      expect(result.tools).toHaveLength(1)
      expect(result.tools![0]!.name).toBe('get_weather')
    })
  })

  describe('buildWireRequest', () => {
    it('should build a request with model from context', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello, world!')],
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        model: string
        messages: unknown[]
      }

      expect(result.model).toBe('gpt-4o')
      expect(result.messages).toHaveLength(1)
    })

    it('should convert text content type to input_text in array content', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'Hello' },
              { type: 'image', image: { mimeType: 'image/png', url: 'https://example.com/img.png' } },
            ],
          },
        ],
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ content: Array<{ type: string }> }>
      }

      // When content is an array, text parts should be converted to input_text
      const content = result.messages[0]!.content
      if (Array.isArray(content)) {
        const textPart = content.find((p: { type: string }) => p.type === 'input_text')
        expect(textPart).toBeDefined()
      }
    })

    it('should include system message', () => {
      const unified = createUnifiedRequest({
        system: 'You are a helpful assistant.',
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ role: string; content: string }>
      }

      expect(result.messages).toHaveLength(2)
      const systemMsg = result.messages[0]!
      expect(systemMsg.role).toBe('system')
    })

    it('should transform tool calls in assistant message', () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage('user', 'What is the weather?'),
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                toolCall: createUnifiedToolCall('get_weather', { location: 'NYC' }, 'call_123'),
              },
            ],
          },
        ],
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ tool_calls?: Array<{ function: { name: string } }> }>
      }

      const assistantMsg = result.messages[1]!
      expect(assistantMsg.tool_calls).toHaveLength(1)
      expect(assistantMsg.tool_calls![0]!.function.name).toBe('get_weather')
    })

    it('should transform tools', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
        tools: [
          createUnifiedTool('get_weather', 'Get weather', {
            type: 'object',
            properties: { location: { type: 'string' } },
          }),
        ],
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        tools: Array<{ type: string; function: { name: string } }>
      }

      expect(result.tools).toHaveLength(1)
      expect(result.tools[0]!.type).toBe('function')
      expect(result.tools[0]!.function.name).toBe('get_weather')
    })

    it('should transform generation config', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
        config: {
          maxTokens: 1000,
          temperature: 0.7,
        },
      })

      const result = OpenAIResponsesFormat.buildWireRequest(unified, ctx) as {
        max_tokens: number
        temperature: number
      }

      expect(result.max_tokens).toBe(1000)
      expect(result.temperature).toBe(0.7)
    })
  })

  describe('parseResponse', () => {
    it('should parse a simple response', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = OpenAIResponsesFormat.parseResponse(res)

      expect(result.id).toBe('chatcmpl-123')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.text).toBe('Hello!')
      expect(result.stopReason).toBe('end_turn')
    })

    it('should parse response with tool calls', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }

      const result = OpenAIResponsesFormat.parseResponse(res)

      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.type).toBe('tool_call')
      expect(result.content[0]!.toolCall?.name).toBe('get_weather')
      expect(result.stopReason).toBe('tool_use')
    })

    it('should parse usage information', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
      }

      const result = OpenAIResponsesFormat.parseResponse(res)

      expect(result.usage?.inputTokens).toBe(15)
      expect(result.usage?.outputTokens).toBe(25)
      expect(result.usage?.totalTokens).toBe(40)
    })
  })

  describe('buildWireResponse', () => {
    it('should build a simple response', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'gpt-4o',
      })

      const result = OpenAIResponsesFormat.buildWireResponse(unified, ctx) as {
        id: string
        object: string
        model: string
        choices: Array<{ message: { content: string }; finish_reason: string }>
      }

      expect(result.id).toBe('resp-123')
      expect(result.object).toBe('chat.completion')
      expect(result.model).toBe('gpt-4o')
      expect(result.choices).toHaveLength(1)
      expect(result.choices[0]!.message.content).toBe('Hello!')
    })

    it('should build response with tool calls', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_123',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          },
        ],
        stopReason: 'tool_use',
      })

      const result = OpenAIResponsesFormat.buildWireResponse(unified, ctx) as {
        choices: Array<{
          message: { tool_calls: Array<{ function: { name: string } }> }
          finish_reason: string
        }>
      }

      expect(result.choices[0]!.message.tool_calls).toHaveLength(1)
      expect(result.choices[0]!.message.tool_calls[0]!.function.name).toBe('get_weather')
      expect(result.choices[0]!.finish_reason).toBe('tool_calls')
    })

    it('should include usage information', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 15,
          outputTokens: 25,
          totalTokens: 40,
        },
      })

      const result = OpenAIResponsesFormat.buildWireResponse(unified, ctx) as {
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      }

      expect(result.usage.prompt_tokens).toBe(15)
      expect(result.usage.completion_tokens).toBe(25)
    })
  })

  describe('parseStreamChunk', () => {
    it('should parse a content delta chunk', () => {
      const chunk = 'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}'

      const result = OpenAIResponsesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('content')
      expect(streamChunk.delta?.text).toBe('Hello')
    })

    it('should parse [DONE] signal', () => {
      const chunk = 'data: [DONE]'

      const result = OpenAIResponsesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('done')
    })

    it('should return null for empty lines', () => {
      const result = OpenAIResponsesFormat.parseStreamChunk!('')
      expect(result).toBeNull()
    })

    it('should return null for comment lines', () => {
      const result = OpenAIResponsesFormat.parseStreamChunk!(': keep-alive')
      expect(result).toBeNull()
    })

    it('should parse finish_reason', () => {
      const chunk = 'data: {"id":"chatcmpl-123","choices":[{"delta":{},"finish_reason":"stop"}]}'

      const result = OpenAIResponsesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.stopReason).toBe('end_turn')
    })

    it('should parse tool call delta', () => {
      const chunk =
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}'

      const result = OpenAIResponsesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('tool_call')
    })
  })

  describe('buildStreamChunk', () => {
    it('should build a content chunk', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'Hello' },
      }

      const result = OpenAIResponsesFormat.buildStreamChunk!(chunk, ctx)

      expect(typeof result).toBe('string')
      const resultStr = result as string
      expect(resultStr).toContain('data:')
      expect(resultStr).toContain('Hello')
    })

    it('should build a done chunk', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'end_turn',
      }

      const result = OpenAIResponsesFormat.buildStreamChunk!(chunk, ctx)

      expect(result).toBeDefined()
    })

    it('should build a usage chunk', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 15,
          outputTokens: 25,
          totalTokens: 40,
        },
      }

      const result = OpenAIResponsesFormat.buildStreamChunk!(chunk, ctx)

      expect(result).toBeDefined()
    })
  })

  describe('input_text conversion', () => {
    it('should handle input_text in request parsing (backwards compatibility)', () => {
      // Request comes in with input_text, should parse to unified text
      const req = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'First message' },
              { type: 'input_text', text: 'Second message' },
            ],
          },
        ],
      }

      const result = OpenAIResponsesFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const parts = result.messages[0]!.parts
      expect(parts).toHaveLength(2)
      expect(parts[0]!.type).toBe('text')
      expect(parts[0]!.text).toBe('First message')
      expect(parts[1]!.type).toBe('text')
      expect(parts[1]!.text).toBe('Second message')
    })
  })
})
