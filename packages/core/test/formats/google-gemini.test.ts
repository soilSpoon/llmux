import { describe, expect, it } from 'bun:test'
import { GoogleGeminiFormat } from '../../src/formats/google-gemini'
import type { FormatContext } from '../../src/formats/base'
import type { StreamChunk } from '../../src/types/unified'
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
  createUnifiedToolCall,
} from '../providers/_utils/fixtures'

describe('GoogleGeminiFormat', () => {
  const ctx: FormatContext = {
    provider: 'google',
    model: 'gemini-1.5-pro',
  }

  describe('id', () => {
    it('should have id "google-gemini"', () => {
      expect(GoogleGeminiFormat.id).toBe('google-gemini')
    })
  })

  describe('isSupportedWireRequest', () => {
    it('should return true for valid Gemini request', () => {
      const req = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      }
      expect(GoogleGeminiFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return false for request with messages field (OpenAI style)', () => {
      const req = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        messages: [{ role: 'user', content: 'Hello' }],
      }
      expect(GoogleGeminiFormat.isSupportedWireRequest(req)).toBe(false)
    })

    it('should return false for request without contents', () => {
      const req = {
        generationConfig: { temperature: 0.5 },
      }
      expect(GoogleGeminiFormat.isSupportedWireRequest(req)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(GoogleGeminiFormat.isSupportedWireRequest(null)).toBe(false)
      expect(GoogleGeminiFormat.isSupportedWireRequest(undefined)).toBe(false)
      expect(GoogleGeminiFormat.isSupportedWireRequest('string')).toBe(false)
    })
  })

  describe('isSupportedWireResponse', () => {
    it('should return true for valid Gemini response', () => {
      const res = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hello!' }] },
            finishReason: 'STOP',
          },
        ],
      }
      expect(GoogleGeminiFormat.isSupportedWireResponse(res)).toBe(true)
    })

    it('should return false for non-object values', () => {
      expect(GoogleGeminiFormat.isSupportedWireResponse(null)).toBe(false)
      expect(GoogleGeminiFormat.isSupportedWireResponse(undefined)).toBe(false)
    })
  })

  describe('parseRequest', () => {
    it('should parse a simple Gemini request', () => {
      const req = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      }

      const result = GoogleGeminiFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0]!
      expect(msg.role).toBe('user')
      const part = msg.parts[0]!
      expect(part.type).toBe('text')
      expect(part.text).toBe('Hello')
    })

    it('should parse system instruction', () => {
      const req = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        systemInstruction: { parts: [{ text: 'You are helpful.' }] },
      }

      const result = GoogleGeminiFormat.parseRequest(req)

      expect(result.system).toBe('You are helpful.')
    })

    it('should parse tool call', () => {
      const req = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'get_weather',
                  args: { location: 'NYC' },
                },
              },
            ],
          },
        ],
      }

      const result = GoogleGeminiFormat.parseRequest(req)

      const msg = result.messages[0]!
      expect(msg.role).toBe('assistant')
      const part = msg.parts[0]!
      expect(part.type).toBe('tool_call')
      expect(part.toolCall?.name).toBe('get_weather')
    })

    it('should parse generation config', () => {
      const req = {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
        },
      }

      const result = GoogleGeminiFormat.parseRequest(req)

      expect(result.config?.maxTokens).toBe(1000)
      expect(result.config?.temperature).toBe(0.7)
      expect(result.config?.topP).toBe(0.9)
    })
  })

  describe('buildWireRequest', () => {
    it('should build a simple Gemini request', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = GoogleGeminiFormat.buildWireRequest(unified, ctx) as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>
      }

      expect(result.contents).toHaveLength(1)
      expect(result.contents[0]!.role).toBe('user')
      expect(result.contents[0]!.parts[0]!.text).toBe('Hello')
    })

    it('should include system instruction', () => {
      const unified = createUnifiedRequest({
        system: 'You are helpful.',
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = GoogleGeminiFormat.buildWireRequest(unified, ctx) as {
        systemInstruction: { parts: Array<{ text: string }> }
      }

      expect(result.systemInstruction).toBeDefined()
      expect(result.systemInstruction.parts[0]!.text).toBe('You are helpful.')
    })

    it('should transform tool calls', () => {
      const unified = createUnifiedRequest({
        messages: [
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

      const result = GoogleGeminiFormat.buildWireRequest(unified, ctx) as {
        contents: Array<{
          parts: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }>
        }>
      }

      const part = result.contents[0]!.parts[0]!
      expect(part.functionCall).toBeDefined()
      expect(part.functionCall?.name).toBe('get_weather')
      expect(part.functionCall?.args['location']).toBe('NYC')
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

      const result = GoogleGeminiFormat.buildWireRequest(unified, ctx) as {
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>
      }

      expect(result.tools).toHaveLength(1)
      expect(result.tools[0]!.functionDeclarations).toHaveLength(1)
      expect(result.tools[0]!.functionDeclarations[0]!.name).toBe('get_weather')
    })
  })

  describe('parseResponse', () => {
    it('should parse a simple response', () => {
      const res = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hello!' }] },
            finishReason: 'STOP',
          },
        ],
      }

      const result = GoogleGeminiFormat.parseResponse(res)

      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.text).toBe('Hello!')
      expect(result.stopReason).toBe('end_turn')
    })

    it('should parse response with function call', () => {
      const res = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'NYC' },
                  },
                },
              ],
            },
            finishReason: 'functionCall', // Gemini sends STOP or specialized reason depending on version
          },
        ],
      }

      const result = GoogleGeminiFormat.parseResponse(res)

      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.type).toBe('tool_call')
      expect(result.content[0]!.toolCall?.name).toBe('get_weather')
    })
  })

  describe('buildWireResponse', () => {
    it('should build a simple response', () => {
      const unified = createUnifiedResponse({
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
      })

      const result = GoogleGeminiFormat.buildWireResponse(unified, ctx) as {
        candidates: Array<{
          content: { parts: Array<{ text: string }> }
          finishReason: string
        }>
      }

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.content.parts[0]!.text).toBe('Hello!')
      expect(result.candidates[0]!.finishReason).toBe('STOP')
    })

    it('should build response with tool call', () => {
      const unified = createUnifiedResponse({
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

      const result = GoogleGeminiFormat.buildWireResponse(unified, ctx) as {
        candidates: Array<{
          content: { parts: Array<{ functionCall?: { name: string } }> }
        }>
      }

      expect(result.candidates[0]!.content.parts[0]!.functionCall).toBeDefined()
      expect(result.candidates[0]!.content.parts[0]!.functionCall?.name).toBe('get_weather')
    })
  })

  describe('parseStreamChunk', () => {
    it('should parse content chunk', () => {
      const chunk =
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}'

      const result = GoogleGeminiFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('content')
      expect(streamChunk.delta?.text).toBe('Hello')
    })

    it('should parse usage included with content chunk', () => {
      const chunk =
        'data: {"candidates":[{"content":{"parts":[{"text":"Done"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}'

      const result = GoogleGeminiFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.usage).toBeDefined()
      expect(streamChunk.usage?.totalTokens).toBe(15)
    })
  })

  describe('buildStreamChunk', () => {
    it('should build a content chunk', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'Hello' },
      }

      const result = GoogleGeminiFormat.buildStreamChunk!(chunk, ctx)

      expect(typeof result).toBe('string')
      const resultStr = result as string
      expect(resultStr).toContain('data:')
      expect(resultStr).toContain('Hello')
    })

    it('should build a usage chunk', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      }

      const result = GoogleGeminiFormat.buildStreamChunk!(chunk, ctx)

      expect(result).toBeDefined()
      const resultStr = result as string
      expect(resultStr).toContain('usageMetadata')
      expect(resultStr).toContain('15')
    })
  })
})
