import { describe, expect, it } from 'bun:test'
import { parse, transform } from '../../../src/providers/ai-sdk/request'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { createUnifiedMessage, createUnifiedRequest, createUnifiedTool } from '../_utils/fixtures'

describe('AI SDK Request Transformations', () => {
  describe('parse', () => {
    it('parses basic text prompt to UnifiedRequest', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: [{ type: 'text', text: 'Hello!' }] },
        ],
      }

      const result = parse(options)

      expect(result.system).toBe('You are helpful.')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]?.role).toBe('user')
      expect(result.messages[0]?.parts[0]?.text).toBe('Hello!')
    })

    it('parses generation config', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        stopSequences: ['STOP'],
      }

      const result = parse(options)

      expect(result.config?.maxTokens).toBe(1000)
      expect(result.config?.temperature).toBe(0.7)
      expect(result.config?.topP).toBe(0.9)
      expect(result.config?.topK).toBe(50)
      expect(result.config?.stopSequences).toEqual(['STOP'])
    })

    it('parses assistant message with text', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
        ],
      }

      const result = parse(options)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]?.role).toBe('assistant')
      expect(result.messages[1]?.parts[0]?.text).toBe('Hi there!')
    })

    it('parses assistant message with reasoning', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Think about this' }] },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'Let me think...' },
              { type: 'text', text: 'The answer is 42.' },
            ],
          },
        ],
      }

      const result = parse(options)

      expect(result.messages[1]?.parts).toHaveLength(2)
      expect(result.messages[1]?.parts[0]?.type).toBe('thinking')
      expect(result.messages[1]?.parts[0]?.thinking?.text).toBe('Let me think...')
      expect(result.messages[1]?.parts[1]?.type).toBe('text')
    })

    it('parses assistant message with tool call', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Get weather' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call_123',
                toolName: 'get_weather',
                input: { location: 'NYC' },
              },
            ],
          },
        ],
      }

      const result = parse(options)

      expect(result.messages[1]?.parts[0]?.type).toBe('tool_call')
      expect(result.messages[1]?.parts[0]?.toolCall?.id).toBe('call_123')
      expect(result.messages[1]?.parts[0]?.toolCall?.name).toBe('get_weather')
      expect(result.messages[1]?.parts[0]?.toolCall?.arguments).toEqual({ location: 'NYC' })
    })

    it('parses tool message with result', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Get weather' }] },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call_123',
                toolName: 'get_weather',
                output: { type: 'text', value: 'Sunny, 72°F' },
              },
            ],
          },
        ],
      }

      const result = parse(options)

      expect(result.messages[1]?.role).toBe('tool')
      expect(result.messages[1]?.parts[0]?.type).toBe('tool_result')
      expect(result.messages[1]?.parts[0]?.toolResult?.toolCallId).toBe('call_123')
      expect(result.messages[1]?.parts[0]?.toolResult?.content).toBe('Sunny, 72°F')
    })

    it('parses user message with file (base64)', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this image?' },
              { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
            ],
          },
        ],
      }

      const result = parse(options)

      expect(result.messages[0]?.parts).toHaveLength(2)
      expect(result.messages[0]?.parts[1]?.type).toBe('image')
      expect(result.messages[0]?.parts[1]?.image?.mimeType).toBe('image/png')
      expect(result.messages[0]?.parts[1]?.image?.data).toBe('iVBORw0KGgo=')
    })

    it('parses user message with file URL', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'file', mediaType: 'image/jpeg', data: 'https://example.com/image.jpg' },
            ],
          },
        ],
      }

      const result = parse(options)

      expect(result.messages[0]?.parts[0]?.type).toBe('image')
      expect(result.messages[0]?.parts[0]?.image?.url).toBe('https://example.com/image.jpg')
    })

    it('parses tools', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get the weather',
            inputSchema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        ],
      }

      const result = parse(options)

      expect(result.tools).toHaveLength(1)
      expect(result.tools?.[0]?.name).toBe('get_weather')
      expect(result.tools?.[0]?.description).toBe('Get the weather')
    })
  })

  describe('transform', () => {
    it('transforms UnifiedRequest to AI SDK format', () => {
      const unified = createUnifiedRequest({
        system: 'Be helpful',
        messages: [createUnifiedMessage('user', 'Hi')],
        config: {
          maxTokens: 500,
          temperature: 0.5,
          topP: 0.9,
          topK: 40,
          stopSequences: ['END'],
        },
      })

      const result = transform(unified)

      expect(result.prompt).toHaveLength(2)
      expect(result.prompt[0]?.role).toBe('system')
      expect((result.prompt[0] as { content: string }).content).toBe('Be helpful')
      expect(result.prompt[1]?.role).toBe('user')
      expect(result.maxOutputTokens).toBe(500)
      expect(result.temperature).toBe(0.5)
      expect(result.topP).toBe(0.9)
      expect(result.topK).toBe(40)
      expect(result.stopSequences).toEqual(['END'])
    })

    it('transforms assistant message with tool call', () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage('user', 'Get weather'),
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                toolCall: {
                  id: 'call_abc',
                  name: 'get_weather',
                  arguments: { location: 'NYC' },
                },
              },
            ],
          },
        ],
      })

      const result = transform(unified)

      expect(result.prompt[1]?.role).toBe('assistant')
      const assistantContent = (result.prompt[1] as { content: unknown[] }).content
      expect(assistantContent[0]).toEqual({
        type: 'tool-call',
        toolCallId: 'call_abc',
        toolName: 'get_weather',
        input: { location: 'NYC' },
      })
    })

    it('transforms tool message', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'tool',
            parts: [
              {
                type: 'tool_result',
                toolResult: {
                  toolCallId: 'call_abc',
                  content: 'Sunny, 72°F',
                },
              },
            ],
          },
        ],
      })

      const result = transform(unified)

      expect(result.prompt[0]?.role).toBe('tool')
      const toolContent = (result.prompt[0] as { content: unknown[] }).content
      expect(toolContent[0]).toMatchObject({
        type: 'tool-result',
        toolCallId: 'call_abc',
        output: { type: 'text', value: 'Sunny, 72°F' },
      })
    })

    it('transforms thinking content to reasoning', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'thinking', thinking: { text: 'Let me think...' } },
              { type: 'text', text: 'Answer' },
            ],
          },
        ],
      })

      const result = transform(unified)

      const assistantContent = (result.prompt[0] as { content: unknown[] }).content
      expect(assistantContent[0]).toEqual({ type: 'reasoning', text: 'Let me think...' })
      expect(assistantContent[1]).toEqual({ type: 'text', text: 'Answer' })
    })

    it('transforms tools to function tools', () => {
      const unified = createUnifiedRequest({
        tools: [
          createUnifiedTool('get_weather', 'Get weather info', {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          }),
        ],
      })

      const result = transform(unified)

      expect(result.tools).toHaveLength(1)
      expect(result.tools?.[0]).toMatchObject({
        type: 'function',
        name: 'get_weather',
        description: 'Get weather info',
        inputSchema: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      })
    })

    it('transforms image content to file part', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', image: { mimeType: 'image/png', data: 'base64data' } },
            ],
          },
        ],
      })

      const result = transform(unified)

      const userContent = (result.prompt[0] as { content: unknown[] }).content
      expect(userContent[1]).toMatchObject({
        type: 'file',
        mediaType: 'image/png',
        data: 'base64data',
      })
    })
  })

  describe('round-trip', () => {
    it('preserves content through parse -> transform', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
        maxOutputTokens: 1000,
        temperature: 0.7,
      }

      const unified = parse(options)
      const result = transform(unified)

      expect(result.prompt[0]).toEqual({ role: 'system', content: 'Be helpful' })
      expect(result.maxOutputTokens).toBe(1000)
      expect(result.temperature).toBe(0.7)
    })
  })
})
