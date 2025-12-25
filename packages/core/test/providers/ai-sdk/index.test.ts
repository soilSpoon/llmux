import { describe, expect, it } from 'bun:test'
import { AiSdkProvider } from '../../../src/providers/ai-sdk'
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { createUnifiedRequest, createUnifiedMessage, createUnifiedResponse } from '../_utils/fixtures'

describe('AiSdkProvider', () => {
  const provider = new AiSdkProvider()

  describe('provider configuration', () => {
    it('has config', () => {
      expect(provider.config.supportsStreaming).toBe(true)
      expect(provider.config.supportsThinking).toBe(true)
      expect(provider.config.supportsTools).toBe(true)
    })
  })

  describe('parse', () => {
    it('parses AI SDK call options to UnifiedRequest', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: [{ type: 'text', text: 'Hello!' }] },
        ],
        maxOutputTokens: 1000,
        temperature: 0.7,
      }

      const result = provider.parse(options)

      expect(result.system).toBe('You are helpful.')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]?.parts[0]?.text).toBe('Hello!')
      expect(result.config?.maxTokens).toBe(1000)
      expect(result.config?.temperature).toBe(0.7)
    })

    it('throws on invalid request', () => {
      expect(() => provider.parse({})).toThrow()
      expect(() => provider.parse({ prompt: 'string' })).toThrow()
      expect(() => provider.parse(null)).toThrow()
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
        },
      })

      const result = provider.transform(unified)

      expect(result.prompt).toHaveLength(2)
      expect(result.prompt[0]?.role).toBe('system')
      expect(result.maxOutputTokens).toBe(500)
      expect(result.temperature).toBe(0.5)
    })
  })

  describe('parseResponse', () => {
    it('parses AI SDK generate result to UnifiedResponse', () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [{ type: 'text', text: 'Hello there!' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
        response: {
          id: 'resp-123',
          modelId: 'gpt-4',
        },
      }

      const result = provider.parseResponse(aiSdkResult)

      expect(result.id).toBe('resp-123')
      expect(result.model).toBe('gpt-4')
      expect(result.content[0]?.text).toBe('Hello there!')
      expect(result.stopReason).toBe('end_turn')
    })

    it('throws on invalid response', () => {
      expect(() => provider.parseResponse({})).toThrow()
      expect(() => provider.parseResponse(null)).toThrow()
    })
  })

  describe('transformResponse', () => {
    it('transforms UnifiedResponse to AI SDK format', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'gpt-4',
      })

      const result = provider.transformResponse(unified)

      expect(result.content).toHaveLength(1)
      expect((result.content[0] as { text: string }).text).toBe('Hello!')
      expect(result.finishReason.unified).toBe('stop')
      expect(result.response?.id).toBe('resp-123')
    })
  })

  describe('parseStreamChunk', () => {
    it('parses JSON stream chunk', () => {
      const chunk = JSON.stringify({
        type: 'text-delta',
        id: 'text-1',
        delta: 'Hello',
      })

      const result = provider.parseStreamChunk(chunk)

      expect(result?.type).toBe('content')
      expect(result?.delta?.text).toBe('Hello')
    })

    it('returns null for invalid JSON', () => {
      const result = provider.parseStreamChunk('invalid json')
      expect(result).toBeNull()
    })

    it('parses finish chunk', () => {
      const chunk = JSON.stringify({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      })

      const result = provider.parseStreamChunk(chunk)

      expect(result?.type).toBe('done')
      expect(result?.stopReason).toBe('end_turn')
    })
  })

  describe('transformStreamChunk', () => {
    it('transforms content chunk', () => {
      const result = provider.transformStreamChunk({
        type: 'content',
        delta: { type: 'text', text: 'Hi' },
      })

      expect(result).toBeTruthy()
      const parsed = JSON.parse(result)
      expect(parsed.type).toBe('text-delta')
      expect(parsed.delta).toBe('Hi')
    })

    it('returns empty string for non-transformable chunk', () => {
      const result = provider.transformStreamChunk({
        type: 'content',
        delta: { type: 'text' }, // No text
      })

      expect(result).toBe('')
    })
  })

  describe('round-trip transformations', () => {
    it('request round-trip preserves content', () => {
      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
        maxOutputTokens: 100,
        temperature: 0.5,
      }

      const unified = provider.parse(options)
      const result = provider.transform(unified)

      expect(result.prompt[0]).toEqual({ role: 'system', content: 'Be helpful' })
      expect(result.maxOutputTokens).toBe(100)
      expect(result.temperature).toBe(0.5)
    })

    it('response round-trip preserves content', () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [{ type: 'text', text: 'Hello!' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
        response: {
          id: 'resp-123',
        },
      }

      const unified = provider.parseResponse(aiSdkResult)
      const result = provider.transformResponse(unified)

      expect((result.content[0] as { text: string }).text).toBe('Hello!')
      expect(result.finishReason.unified).toBe('stop')
      expect(result.response?.id).toBe('resp-123')
    })
  })
})
