
import { describe, it, expect } from 'bun:test'
import { buildGeminiThinkingConfig } from '../../../src/formats/gemini/antigravity/gemini'

describe('Antigravity Gemini Transforms', () => {
  describe('buildGeminiThinkingConfig', () => {
    it('should return undefined if thinking is disabled', () => {
      expect(buildGeminiThinkingConfig({ enabled: false }, 'level')).toBeUndefined()
      expect(buildGeminiThinkingConfig(undefined, 'level')).toBeUndefined()
    })

    it('should support Gemini 3 Level style', () => {
      expect(buildGeminiThinkingConfig({ enabled: true, level: 'low' }, 'level')).toEqual({
        include_thoughts: true,
        thinking_level: 'LOW'
      })
      expect(buildGeminiThinkingConfig({ enabled: true, level: 'high' }, 'level')).toEqual({
        include_thoughts: true,
        thinking_level: 'HIGH'
      })
    })

    it('should convert budget to level if level style requested', () => {
      expect(buildGeminiThinkingConfig({ enabled: true, budget: 1024 }, 'level')).toEqual({
        include_thoughts: true,
        thinking_level: 'LOW'
      })
      expect(buildGeminiThinkingConfig({ enabled: true, budget: 16384 }, 'level')).toEqual({
        include_thoughts: true,
        thinking_level: 'MEDIUM'
      })
      expect(buildGeminiThinkingConfig({ enabled: true, budget: 32768 }, 'level')).toEqual({
        include_thoughts: true,
        thinking_level: 'HIGH'
      })
    })

    it('should support Gemini 2.5 Budget style', () => {
      expect(buildGeminiThinkingConfig({ enabled: true, budget: 4096 }, 'budget')).toEqual({
        include_thoughts: true,
        thinking_budget: 4096
      })
    })

    it('should use default budget if missing in Budget style', () => {
      expect(buildGeminiThinkingConfig({ enabled: true }, 'budget')).toEqual({
        include_thoughts: true,
        thinking_budget: 8192
      })
    })

    it('should map effort to budget in Budget style', () => {
      expect(buildGeminiThinkingConfig({ enabled: true, effort: 'low' }, 'budget')).toEqual({
        include_thoughts: true,
        thinking_budget: 8192
      })
      expect(buildGeminiThinkingConfig({ enabled: true, effort: 'medium' }, 'budget')).toEqual({
        include_thoughts: true,
        thinking_budget: 16384
      })
      expect(buildGeminiThinkingConfig({ enabled: true, effort: 'high' }, 'budget')).toEqual({
        include_thoughts: true,
        thinking_budget: 32768
      })
    })
  })
})
