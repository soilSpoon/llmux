import { describe, expect, it } from 'bun:test'
import { applyThinkingConfig } from '../../src/transform/thinking'
import type { UnifiedRequest } from '../../src/types/unified'

describe('applyThinkingConfig (transform)', () => {
  describe('OpenAI provider', () => {
    it('applies reasoning effort from unified request', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          effort: 'high',
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      expect(target.reasoning_effort).toBe('high')
    })

    it('normalizes effort using model from metadata', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          effort: 'low',
        },
        metadata: {
          model: 'gpt-5-pro',
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      // gpt-5-pro only supports 'high', so 'low' should fallback to 'high'
      expect(target.reasoning_effort).toBe('high')
    })

    it('uses original effort when no model in metadata', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          effort: 'low',
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      // No model available, should use original value
      expect(target.reasoning_effort).toBe('low')
    })

    it('passes through supported effort when model supports it', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          effort: 'medium',
        },
        metadata: {
          model: 'gpt-5.1',
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      // gpt-5.1 supports low/medium/high
      expect(target.reasoning_effort).toBe('medium')
    })

    it('does not set reasoning_effort when normalized to undefined', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          effort: 'none' as 'none' | 'low' | 'medium' | 'high',
        },
        metadata: {
          // Unknown model defaults to low/medium/high support, no default
          model: 'unknown-model',
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      // 'none' is not supported by unknown model, and no default is set
      expect(target.reasoning_effort).toBeUndefined()
    })

    it('adds includeThoughts to include array', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          includeThoughts: true,
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      expect((target.include as string[]).includes('reasoning.encrypted_content')).toBe(true)
    })
  })

  describe('Anthropic provider', () => {
    it('applies thinking with budget', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
          budget: 2048,
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'anthropic', target)
      expect(target.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 2048,
      })
    })

    it('uses default budget of 1024', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: true,
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'anthropic', target)
      expect(target.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 1024,
      })
    })
  })

  describe('disabled thinking', () => {
    it('does nothing when thinking is not enabled', () => {
      const unified: UnifiedRequest = {
        messages: [],
        thinking: {
          enabled: false,
        },
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      expect(target.reasoning_effort).toBeUndefined()
    })

    it('does nothing when thinking config is undefined', () => {
      const unified: UnifiedRequest = {
        messages: [],
      }
      const target: Record<string, unknown> = {}

      applyThinkingConfig(unified, 'openai', target)
      expect(target.reasoning_effort).toBeUndefined()
    })
  })
})
