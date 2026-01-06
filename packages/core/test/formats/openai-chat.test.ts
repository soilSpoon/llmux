import { describe, expect, it } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'
import type { FormatContext } from '../../src/formats/base'
import type { StreamChunk } from '../../src/types/unified'
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
  createUnifiedToolCall,
} from '../providers/_utils/fixtures'

describe('OpenAIChatFormat', () => {
  const ctx: FormatContext = {
    provider: 'openai',
    model: 'gpt-4',
  }

  describe('id', () => {
    it('should have id "openai-chat"', () => {
      expect(OpenAIChatFormat.id).toBe('openai-chat')
    })
  })

  describe('isSupportedWireRequest', () => {
    it('should return true for valid OpenAI Chat Completions request', () => {
      const req = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIChatFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return false for Responses API request (input field)', () => {
      const req = {
        model: 'gpt-4',
        input: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIChatFormat.isSupportedWireRequest(req)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(OpenAIChatFormat.isSupportedWireRequest(null)).toBe(false)
      expect(OpenAIChatFormat.isSupportedWireRequest(undefined)).toBe(false)
      expect(OpenAIChatFormat.isSupportedWireRequest('string')).toBe(false)
      expect(OpenAIChatFormat.isSupportedWireRequest(123)).toBe(false)
    })

    it('should return false for request without model', () => {
      const req = {
        messages: [{ role: 'user', content: 'Hello' }],
      }
      expect(OpenAIChatFormat.isSupportedWireRequest(req)).toBe(false)
    })
  })

  describe('isSupportedWireResponse', () => {
    it('should return true for valid OpenAI response', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }
      expect(OpenAIChatFormat.isSupportedWireResponse(res)).toBe(true)
    })

    it('should return false for non-object values', () => {
      expect(OpenAIChatFormat.isSupportedWireResponse(null)).toBe(false)
      expect(OpenAIChatFormat.isSupportedWireResponse(undefined)).toBe(false)
      expect(OpenAIChatFormat.isSupportedWireResponse('string')).toBe(false)
    })
  })

  describe('parseRequest', () => {
    it('should parse a simple chat request', () => {
      const req = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello, world!' }],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0]!
      expect(msg.role).toBe('user')
      expect(msg.parts).toHaveLength(1)
      const part = msg.parts[0]!
      expect(part.type).toBe('text')
      expect(part.text).toBe('Hello, world!')
    })

    it('should parse system message', () => {
      const req = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.system).toBe('You are helpful.')
      expect(result.messages).toHaveLength(1)
    })

    it('should parse assistant message with tool calls', () => {
      const req = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
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
        ],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.messages).toHaveLength(2)
      const assistantMsg = result.messages[1]!
      expect(assistantMsg.role).toBe('assistant')
      expect(assistantMsg.parts).toHaveLength(1)
      const part = assistantMsg.parts[0]!
      expect(part.type).toBe('tool_call')
      expect(part.toolCall?.name).toBe('get_weather')
    })

    it('should parse tool message', () => {
      const req = {
        model: 'gpt-4',
        messages: [
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '{"temperature": 72}',
          },
        ],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0]!
      expect(msg.role).toBe('tool')
      const part = msg.parts[0]!
      expect(part.type).toBe('tool_result')
      expect(part.toolResult?.toolCallId).toBe('call_123')
    })

    it('should parse generation config', () => {
      const req = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['STOP'],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.config?.maxTokens).toBe(1000)
      expect(result.config?.temperature).toBe(0.7)
      expect(result.config?.topP).toBe(0.9)
      expect(result.config?.stopSequences).toEqual(['STOP'])
    })

    it('should parse tools', () => {
      const req = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
      }

      const result = OpenAIChatFormat.parseRequest(req)

      expect(result.tools).toHaveLength(1)
      const tool = result.tools![0]!
      expect(tool.name).toBe('get_weather')
    })
  })

  describe('buildWireRequest', () => {
    it('should build a simple chat request', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello, world!')],
      })

      const result = OpenAIChatFormat.buildWireRequest(unified, ctx) as {
        model: string
        messages: unknown[]
      }

      expect(result.model).toBe('gpt-4')
      expect(result.messages).toHaveLength(1)
    })

    it('should include system message as first message', () => {
      const unified = createUnifiedRequest({
        system: 'You are helpful.',
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = OpenAIChatFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ role: string; content: string }>
      }

      expect(result.messages).toHaveLength(2)
      const firstMsg = result.messages[0]!
      expect(firstMsg.role).toBe('system')
      expect(firstMsg.content).toBe('You are helpful.')
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

      const result = OpenAIChatFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ tool_calls?: Array<{ function: { name: string } }> }>
      }

      expect(result.messages).toHaveLength(2)
      const assistantMsg = result.messages[1]!
      expect(assistantMsg.tool_calls).toHaveLength(1)
      const toolCall = assistantMsg.tool_calls![0]!
      expect(toolCall.function.name).toBe('get_weather')
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

      const result = OpenAIChatFormat.buildWireRequest(unified, ctx) as {
        tools: Array<{ type: string; function: { name: string } }>
      }

      expect(result.tools).toHaveLength(1)
      const tool = result.tools[0]!
      expect(tool.type).toBe('function')
      expect(tool.function.name).toBe('get_weather')
    })

    it('should transform generation config', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
        config: {
          maxTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
          stopSequences: ['STOP'],
        },
      })

      const result = OpenAIChatFormat.buildWireRequest(unified, ctx) as {
        max_tokens: number
        temperature: number
        top_p: number
        stop: string[]
      }

      expect(result.max_tokens).toBe(1000)
      expect(result.temperature).toBe(0.7)
      expect(result.top_p).toBe(0.9)
      expect(result.stop).toEqual(['STOP'])
    })
  })

  describe('parseResponse', () => {
    it('should parse a simple response', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      }

      const result = OpenAIChatFormat.parseResponse(res)

      expect(result.id).toBe('chatcmpl-123')
      expect(result.content).toHaveLength(1)
      const part = result.content[0]!
      expect(part.type).toBe('text')
      expect(part.text).toBe('Hello!')
      expect(result.stopReason).toBe('end_turn')
    })

    it('should parse response with tool calls', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
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

      const result = OpenAIChatFormat.parseResponse(res)

      expect(result.content).toHaveLength(1)
      const part = result.content[0]!
      expect(part.type).toBe('tool_call')
      expect(part.toolCall?.name).toBe('get_weather')
      expect(result.stopReason).toBe('tool_use')
    })

    it('should parse usage information', () => {
      const res = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }

      const result = OpenAIChatFormat.parseResponse(res)

      expect(result.usage?.inputTokens).toBe(10)
      expect(result.usage?.outputTokens).toBe(20)
      expect(result.usage?.totalTokens).toBe(30)
    })
  })

  describe('buildWireResponse', () => {
    it('should build a simple response', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'gpt-4',
      })

      const result = OpenAIChatFormat.buildWireResponse(unified, ctx) as {
        id: string
        object: string
        model: string
        choices: Array<{ message: { content: string }; finish_reason: string }>
      }

      expect(result.id).toBe('resp-123')
      expect(result.object).toBe('chat.completion')
      expect(result.model).toBe('gpt-4')
      expect(result.choices).toHaveLength(1)
      const choice = result.choices[0]!
      expect(choice.message.content).toBe('Hello!')
      expect(choice.finish_reason).toBe('stop')
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

      const result = OpenAIChatFormat.buildWireResponse(unified, ctx) as {
        choices: Array<{
          message: { tool_calls: Array<{ id: string; function: { name: string } }> }
          finish_reason: string
        }>
      }

      const choice = result.choices[0]!
      expect(choice.message.tool_calls).toHaveLength(1)
      const toolCall = choice.message.tool_calls[0]!
      expect(toolCall.function.name).toBe('get_weather')
      expect(choice.finish_reason).toBe('tool_calls')
    })

    it('should include usage information', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      })

      const result = OpenAIChatFormat.buildWireResponse(unified, ctx) as {
        usage: { prompt_tokens: number; completion_tokens: number }
      }

      expect(result.usage.prompt_tokens).toBe(10)
      expect(result.usage.completion_tokens).toBe(20)
    })
  })

  describe('parseStreamChunk', () => {
    it('should parse a content delta chunk', () => {
      const chunk = 'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}'

      const result = OpenAIChatFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('content')
      expect(streamChunk.delta?.text).toBe('Hello')
    })

    it('should parse [DONE] signal', () => {
      const chunk = 'data: [DONE]'

      const result = OpenAIChatFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('done')
    })

    it('should return null for empty lines', () => {
      const result = OpenAIChatFormat.parseStreamChunk!('')
      expect(result).toBeNull()
    })

    it('should return null for comment lines', () => {
      const result = OpenAIChatFormat.parseStreamChunk!(': keep-alive')
      expect(result).toBeNull()
    })

    it('should parse finish_reason', () => {
      const chunk = 'data: {"id":"chatcmpl-123","choices":[{"delta":{},"finish_reason":"stop"}]}'

      const result = OpenAIChatFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.stopReason).toBe('end_turn')
    })

    it('should parse tool call delta', () => {
      const chunk =
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}'

      const result = OpenAIChatFormat.parseStreamChunk!(chunk)

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

      const result = OpenAIChatFormat.buildStreamChunk!(chunk, ctx)

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

      const result = OpenAIChatFormat.buildStreamChunk!(chunk, ctx)

      // Should include both message_delta and [DONE]
      expect(result).toBeDefined()
    })

    it('should build a usage chunk', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      }

      const result = OpenAIChatFormat.buildStreamChunk!(chunk, ctx)

      expect(result).toBeDefined()
    })
  })
})
