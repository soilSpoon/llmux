import { describe, expect, it } from 'bun:test'
import { parse, transform } from '../../../src/providers/openai/request'
import type { OpenAIRequest } from '../../../src/providers/openai/types'
import type { UnifiedRequest } from '../../../src/types/unified'
import { createUnifiedMessage, createUnifiedRequest, createUnifiedTool, createUnifiedToolCall } from '../_utils/fixtures'

describe('OpenAI Request Transform', () => {
  describe('transform (UnifiedRequest → OpenAIRequest)', () => {
    it('transforms a simple text message', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello, world!')],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.model).toBe('gpt-4')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toEqual({
        role: 'user',
        content: 'Hello, world!',
      })
    })

    it('transforms system message into first message', () => {
      const unified = createUnifiedRequest({
        system: 'You are a helpful assistant.',
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      })
      expect(result.messages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      })
    })

    it('transforms assistant message', () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage('user', 'Hello'),
          createUnifiedMessage('assistant', 'Hi there!'),
        ],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hi there!',
      })
    })

    it('transforms generation config', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
        config: {
          maxTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
          stopSequences: ['STOP', 'END'],
        },
      })

      const result = transform(unified, 'gpt-4')

      expect(result.max_tokens).toBe(1000)
      expect(result.temperature).toBe(0.7)
      expect(result.top_p).toBe(0.9)
      expect(result.stop).toEqual(['STOP', 'END'])
    })

    it('transforms tools', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'What is the weather?')],
        tools: [
          createUnifiedTool('get_weather', 'Get weather for a location', {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          }),
        ],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.tools).toHaveLength(1)
      expect(result.tools![0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      })
    })

    it('transforms assistant message with tool calls', () => {
      const toolCall = createUnifiedToolCall('get_weather', { location: 'NYC' }, 'call_123')
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage('user', 'What is the weather?'),
          {
            role: 'assistant',
            parts: [{ type: 'tool_call', toolCall }],
          },
        ],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.messages).toHaveLength(2)
      const assistantMsg = result.messages[1]
      expect(assistantMsg.role).toBe('assistant')
      expect((assistantMsg as any).tool_calls).toHaveLength(1)
      expect((assistantMsg as any).tool_calls[0]).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"NYC"}',
        },
      })
    })

    it('transforms tool result message', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'tool',
            parts: [
              {
                type: 'tool_result',
                toolResult: {
                  toolCallId: 'call_123',
                  content: '{"temperature": 72}',
                },
              },
            ],
          },
        ],
      })

      const result = transform(unified, 'gpt-4')

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toEqual({
        role: 'tool',
        tool_call_id: 'call_123',
        content: '{"temperature": 72}',
      })
    })

    it('transforms image content', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'image',
                image: {
                  mimeType: 'image/jpeg',
                  url: 'https://example.com/image.jpg',
                },
              },
            ],
          },
        ],
      })

      const result = transform(unified, 'gpt-4o')

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].content).toEqual([
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ])
    })

    it('transforms image with base64 data', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'user',
            parts: [
              {
                type: 'image',
                image: {
                  mimeType: 'image/png',
                  data: 'iVBORw0KGgoAAAANS...',
                },
              },
            ],
          },
        ],
      })

      const result = transform(unified, 'gpt-4o')

      expect(result.messages[0].content).toEqual([
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANS...' },
        },
      ])
    })

    it('transforms thinking config to reasoning_effort', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Solve this problem')],
        thinking: {
          enabled: true,
        },
      })

      const result = transform(unified, 'o1')

      expect(result.reasoning_effort).toBe('medium')
    })

    it('transforms assistant message with text and tool calls', () => {
      const toolCall = createUnifiedToolCall('get_weather', { location: 'NYC' }, 'call_123')
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Let me check the weather.' },
              { type: 'tool_call', toolCall },
            ],
          },
        ],
      })

      const result = transform(unified, 'gpt-4')

      const assistantMsg = result.messages[0]
      expect(assistantMsg.role).toBe('assistant')
      expect((assistantMsg as any).content).toBe('Let me check the weather.')
      expect((assistantMsg as any).tool_calls).toHaveLength(1)
    })
  })

  describe('parse (OpenAIRequest → UnifiedRequest)', () => {
    it('parses a simple text message', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello, world!' },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toEqual({
        role: 'user',
        parts: [{ type: 'text', text: 'Hello, world!' }],
      })
    })

    it('parses system message into system field', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.system).toBe('You are helpful.')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
    })

    it('parses assistant message', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]).toEqual({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there!' }],
      })
    })

    it('parses generation parameters', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['STOP', 'END'],
      }

      const result = parse(openaiRequest)

      expect(result.config).toEqual({
        maxTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ['STOP', 'END'],
      })
    })

    it('parses single stop sequence as array', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stop: 'STOP',
      }

      const result = parse(openaiRequest)

      expect(result.config?.stopSequences).toEqual(['STOP'])
    })

    it('parses tools', () => {
      const openaiRequest: OpenAIRequest = {
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
                properties: { location: { type: 'string' } },
                required: ['location'],
              },
            },
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.tools).toHaveLength(1)
      expect(result.tools![0]).toEqual({
        name: 'get_weather',
        description: 'Get weather',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      })
    })

    it('parses assistant message with tool calls', () => {
      const openaiRequest: OpenAIRequest = {
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

      const result = parse(openaiRequest)

      expect(result.messages).toHaveLength(2)
      const assistantMsg = result.messages[1]
      expect(assistantMsg.role).toBe('assistant')
      expect(assistantMsg.parts).toHaveLength(1)
      expect(assistantMsg.parts[0]).toEqual({
        type: 'tool_call',
        toolCall: {
          id: 'call_123',
          name: 'get_weather',
          arguments: { location: 'NYC' },
        },
      })
    })

    it('parses tool result message', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '{"temperature": 72}',
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toEqual({
        role: 'tool',
        parts: [
          {
            type: 'tool_result',
            toolResult: {
              toolCallId: 'call_123',
              content: '{"temperature": 72}',
            },
          },
        ],
      })
    })

    it('parses multipart content', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
            ],
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].parts).toHaveLength(2)
      expect(result.messages[0].parts[0]).toEqual({ type: 'text', text: 'What is this?' })
      expect(result.messages[0].parts[1]).toEqual({
        type: 'image',
        image: {
          mimeType: 'image/jpeg',
          url: 'https://example.com/img.jpg',
        },
      })
    })

    it('parses base64 image from data URL', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANS...' },
              },
            ],
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages[0].parts[0]).toEqual({
        type: 'image',
        image: {
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANS...',
        },
      })
    })

    it('parses reasoning_effort to thinking config', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'o1',
        messages: [{ role: 'user', content: 'Hello' }],
        reasoning_effort: 'high',
      }

      const result = parse(openaiRequest)

      expect(result.thinking).toEqual({
        enabled: true,
      })
    })

    it('parses assistant message with content and tool calls', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'assistant',
            content: 'Let me check.',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{}' },
              },
            ],
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages[0].parts).toHaveLength(2)
      expect(result.messages[0].parts[0]).toEqual({ type: 'text', text: 'Let me check.' })
      expect(result.messages[0].parts[1].type).toBe('tool_call')
    })

    it('parses image_url string format', () => {
      const openaiRequest: OpenAIRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: 'https://example.com/img.png' },
            ],
          },
        ],
      }

      const result = parse(openaiRequest)

      expect(result.messages[0].parts[0]).toEqual({
        type: 'image',
        image: {
          mimeType: 'image/png',
          url: 'https://example.com/img.png',
        },
      })
    })
  })
})
