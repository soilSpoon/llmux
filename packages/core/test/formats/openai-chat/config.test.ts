import { describe, expect, it } from 'bun:test'
import {
  applyThinkingConfig,
  isGLMModel,
  isReasoningModel,
  parseConfig,
  parseGLMThinking,
  transformToGLMThinking,
} from '../../../src/formats/openai-chat/config'
import type { OpenAIChatRequest } from '../../../src/formats/openai-chat/types'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('OpenAI Chat Config', () => {
  describe('parseConfig', () => {
    it('parses basic config parameters', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4',
        messages: [],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        stop: ['STOP'],
        service_tier: 'auto',
      }

      const config = parseConfig(request)

      expect(config.temperature).toBe(0.7)
      expect(config.topP).toBe(0.9)
      expect(config.maxTokens).toBe(100)
      expect(config.stopSequences).toEqual(['STOP'])
      expect(config.serviceTier).toBe('auto')
    })

    it('parses O-series specific parameters', () => {
      const request: OpenAIChatRequest = {
        model: 'o1-preview',
        messages: [],
        max_completion_tokens: 2000,
      }

      const config = parseConfig(request)

      expect(config.maxTokens).toBe(2000)
    })

    it('parses response format', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4',
        messages: [],
        response_format: { type: 'json_object' },
      }

      const config = parseConfig(request)

      expect(config.responseFormat).toBe('json')
    })

    it('parses array of stop sequences', () => {
      const request: OpenAIChatRequest = {
        model: 'gpt-4',
        messages: [],
        stop: ['STOP1', 'STOP2'],
      }

      const config = parseConfig(request)

      expect(config.stopSequences).toEqual(['STOP1', 'STOP2'])
    })
  })

  describe('Model Detection', () => {
    it('detects reasoning models correctly', () => {
      expect(isReasoningModel('o1-preview')).toBe(true)
      expect(isReasoningModel('o3-mini')).toBe(true)
      expect(isReasoningModel('gpt-5.1')).toBe(true)
      expect(isReasoningModel('gpt-4')).toBe(false)
    })

    it('detects GLM models correctly', () => {
      expect(isGLMModel('glm-4')).toBe(true)
      expect(isGLMModel('GLM-4.5')).toBe(true)
      expect(isGLMModel('gpt-4')).toBe(false)
    })
  })

  describe('Thinking Config', () => {
    describe('parseGLMThinking', () => {
      it('parses enabled thinking config', () => {
        const result = parseGLMThinking({ type: 'enabled' })
        expect(result.enabled).toBe(true)
      })

      it('parses disabled thinking config', () => {
        const result = parseGLMThinking({ type: 'disabled' })
        expect(result.enabled).toBe(false)
      })

      it('parses budget tokens', () => {
        const result = parseGLMThinking({
          type: 'enabled',
          budget_tokens: 1000,
        } as any)
        expect(result.budget).toBe(1000)
      })

      it('parses context preservation', () => {
        const result = parseGLMThinking({
          type: 'enabled',
          clear_thinking: false,
        })
        expect(result.preserveContext).toBe(true)
      })
    })

    describe('transformToGLMThinking', () => {
      it('transforms enabled thinking', () => {
        const result = transformToGLMThinking({ enabled: true })
        expect(result).toEqual({ type: 'enabled' })
      })

      it('transforms disabled thinking', () => {
        const result = transformToGLMThinking({ enabled: false })
        expect(result).toEqual({ type: 'disabled' })
      })

      it('transforms context preservation', () => {
        const result = transformToGLMThinking({
          enabled: true,
          preserveContext: true,
        })
        expect(result).toEqual({
          type: 'enabled',
          clear_thinking: false,
        })
      })

      it('returns undefined for undefined input', () => {
        expect(transformToGLMThinking(undefined)).toBeUndefined()
      })
    })

    describe('applyThinkingConfig', () => {
      it('applies reasoning effort', () => {
        const unified: UnifiedRequest = {
          messages: [],
          thinking: {
            enabled: true,
            effort: 'high',
          },
        }
        const target: OpenAIChatRequest = {
          model: 'o1',
          messages: [],
        }

        applyThinkingConfig(unified, 'o1', target)
        expect(target.reasoning_effort).toBe('high')
      })

      it('does nothing if thinking is disabled', () => {
        const unified: UnifiedRequest = {
          messages: [],
          thinking: {
            enabled: false,
            effort: 'high',
          },
        }
        const target: OpenAIChatRequest = {
          model: 'o1',
          messages: [],
        }

        applyThinkingConfig(unified, 'o1', target)
        expect(target.reasoning_effort).toBeUndefined()
      })
    })
  })
})
