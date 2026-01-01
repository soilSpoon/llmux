import { describe, it, expect } from 'bun:test'
import { parse as parseOpenAI, transform as transformOpenAI } from '../src/providers/openai/request'
import type { UnifiedRequest } from '../src/types/unified'

describe('Integration Tests - Thinking Config Transformations', () => {
  describe('OpenAI → Unified → GLM thinking flow', () => {
    it('parses OpenAI reasoning_effort and transforms to GLM thinking', () => {
      // 1. OpenAI request with reasoning_effort
      const openaiRequest = {
        model: 'o1',
        messages: [{ role: 'user', content: 'Solve this problem' }],
        reasoning_effort: 'high',
      } as any

      // 2. Parse to unified
      const unified = parseOpenAI(openaiRequest)
      expect(unified.thinking).toBeDefined()
      expect(unified.thinking?.enabled).toBe(true)
      expect(unified.thinking?.effort).toBe('high')

      // 3. Transform to GLM
      const glmRequest = transformOpenAI(unified, 'glm-4.6')
      expect(glmRequest.thinking).toBeDefined()
      expect(glmRequest.thinking?.type).toBe('enabled')
    })

    it('parses GLM thinking.type and transforms to OpenAI reasoning_effort', () => {
      // 1. GLM request with thinking
      const glmRequest = {
        model: 'glm-4.6',
        messages: [{ role: 'user', content: 'Complex problem' }],
        thinking: {
          type: 'enabled',
        },
      } as any

      // 2. Parse to unified
      const unified = parseOpenAI(glmRequest)
      expect(unified.thinking).toBeDefined()
      expect(unified.thinking?.enabled).toBe(true)

      // 3. Transform to OpenAI
      const openaiRequest = transformOpenAI(unified, 'o1')
      expect(openaiRequest.reasoning_effort).toBe('medium')
    })

    it('preserves preserveContext through GLM round-trip', () => {
      // 1. GLM request with clear_thinking: false
      const glmRequest = {
        model: 'glm-4.6',
        messages: [{ role: 'user', content: 'Problem' }],
        thinking: {
          type: 'enabled',
          clear_thinking: false,
        },
      } as any

      // 2. Parse to unified
      const unified = parseOpenAI(glmRequest)
      expect(unified.thinking?.preserveContext).toBe(true)

      // 3. Transform back to GLM
      const glmRequest2 = transformOpenAI(unified, 'glm-4.6')
      expect(glmRequest2.thinking?.clear_thinking).toBe(false)
    })
  })

  describe('Thinking config disabled flow', () => {
    it('transforms disabled thinking to reasoning_effort: none', () => {
      // 1. Unified with disabled thinking
      const unified: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Quick Q' }] }],
        thinking: {
          enabled: false,
        },
      }

      // 2. Transform to OpenAI
      const openaiRequest = transformOpenAI(unified, 'gpt-4')
      expect(openaiRequest.reasoning_effort).toBe('none')
    })

    it('transforms disabled thinking to GLM thinking.type: disabled', () => {
      // 1. Unified with disabled thinking
      const unified: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Quick Q' }] }],
        thinking: {
          enabled: false,
        },
      }

      // 2. Transform to GLM
      const glmRequest = transformOpenAI(unified, 'glm-4.6')
      expect(glmRequest.thinking?.type).toBe('disabled')
    })
  })

  describe('Effort level mapping', () => {
    it('maps effort levels correctly across providers', () => {
      const effortLevels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']

      for (const level of effortLevels) {
        const unified: UnifiedRequest = {
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Test' }] }],
          thinking: {
            enabled: true,
            effort: level,
          },
        }

        // OpenAI
        const openaiRequest = transformOpenAI(unified, 'o1')
        expect(openaiRequest.reasoning_effort).toBe(level)

        // GLM (doesn't support effort levels, but still transforms)
        const glmRequest = transformOpenAI(unified, 'glm-4.6')
        expect(glmRequest.thinking?.type).toBe('enabled')
      }
    })
  })

  describe('Model detection in transformations', () => {
    it('detects GLM models correctly', () => {
      const glmModels = ['glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-flash']

      const unified: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Test' }] }],
        thinking: { enabled: true },
      }

      for (const model of glmModels) {
        const result = transformOpenAI(unified, model)
        expect(result.thinking).toBeDefined()
        expect(result.thinking?.type).toBe('enabled')
        expect(result.reasoning_effort).toBeUndefined()
      }
    })

    it('detects O-series models correctly', () => {
      const oSeriesModels = ['o1', 'o3', 'o1-preview', 'o3-mini']

      const unified: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Test' }] }],
        thinking: { enabled: true, effort: 'high' },
      }

      for (const model of oSeriesModels) {
        const result = transformOpenAI(unified, model)
        expect(result.reasoning_effort).toBe('high')
        expect(result.thinking).toBeUndefined()
      }
    })

    it('detects regular OpenAI models correctly', () => {
      const regularModels = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']

      const unified: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Test' }] }],
        thinking: { enabled: true, effort: 'medium' },
      }

      for (const model of regularModels) {
        const result = transformOpenAI(unified, model)
        expect(result.reasoning_effort).toBe('medium')
        expect(result.thinking).toBeUndefined()
      }
    })
  })

  describe('Round-trip consistency', () => {
    it('preserves thinking config through OpenAI → Unified → OpenAI', () => {
      const openaiRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        reasoning_effort: 'high',
      } as any

      // Parse
      const unified = parseOpenAI(openaiRequest)

      // Transform back
      const openaiRequest2 = transformOpenAI(unified, 'gpt-4')

      expect(openaiRequest2.reasoning_effort).toBe('high')
    })

    it('preserves thinking config through GLM → Unified → GLM', () => {
      const glmRequest = {
        model: 'glm-4.6',
        messages: [{ role: 'user', content: 'Test' }],
        thinking: {
          type: 'enabled',
          clear_thinking: false,
        },
      } as any

      // Parse
      const unified = parseOpenAI(glmRequest)

      // Transform back
      const glmRequest2 = transformOpenAI(unified, 'glm-4.6')

      expect(glmRequest2.thinking?.type).toBe('enabled')
      expect(glmRequest2.thinking?.clear_thinking).toBe(false)
    })
  })
})
