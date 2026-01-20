import { describe, expect, it } from 'bun:test'
import { buildGeminiThinkingConfig } from '../../../../src/formats/gemini/antigravity/gemini'

describe('Antigravity: Gemini Transforms', () => {
  describe('buildGeminiThinkingConfig', () => {
    it('should return undefined if thinking is disabled', () => {
      expect(buildGeminiThinkingConfig({ enabled: false }, 'budget')).toBeUndefined()
    })

    it('should use thinkingBudget for budget style (Gemini 2.5)', () => {
      const config = buildGeminiThinkingConfig({ enabled: true, budget: 1024 }, 'budget')
      expect(config).toEqual({
        include_thoughts: true,
        thinking_budget: 1024
      })
    })

    it('should use thinkingLevel for level style (Gemini 3)', () => {
      const configLow = buildGeminiThinkingConfig({ enabled: true, level: 'low' }, 'level')
      expect(configLow).toEqual({
        include_thoughts: true,
        thinking_level: 'LOW'
      })

      const configHigh = buildGeminiThinkingConfig({ enabled: true, level: 'high' }, 'level')
      expect(configHigh).toEqual({
        include_thoughts: true,
        thinking_level: 'HIGH'
      })
    })

    it('should default to LOW level if invalid or missing level', () => {
       const config = buildGeminiThinkingConfig({ enabled: true }, 'level')
       expect(config).toEqual({
         include_thoughts: true,
         thinking_level: 'LOW'
       })
    })
  })
})
