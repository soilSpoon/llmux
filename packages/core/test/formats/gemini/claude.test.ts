import { describe, it, expect } from 'bun:test'
import {
  buildClaudeThinkingConfig,
  configureClaudeToolConfig,
  ensureMaxOutputTokensGreaterThanBudget,
  stripThinkingBlocksForHistory
} from '../../../src/formats/gemini/antigravity/claude'
import type { UnifiedMessage } from '../../../src/types/unified'

describe('Antigravity Claude Transforms', () => {
  describe('buildClaudeThinkingConfig', () => {
    it('should return undefined if thinking is disabled', () => {
      expect(buildClaudeThinkingConfig({ enabled: false })).toBeUndefined()
      expect(buildClaudeThinkingConfig(undefined)).toBeUndefined()
    })

    it('should return valid config with default budget', () => {
      const config = buildClaudeThinkingConfig({ enabled: true })
      expect(config).toEqual({
        include_thoughts: true,
        thinking_budget: 2048
      })
    })

    it('should use provided budget', () => {
      const config = buildClaudeThinkingConfig({ enabled: true, budget: 4096 })
      expect(config).toEqual({
        include_thoughts: true,
        thinking_budget: 4096
      })
    })
  })

  describe('configureClaudeToolConfig', () => {
    it('should return VALIDATED mode', () => {
      const config = configureClaudeToolConfig()
      expect(config.function_calling_config.mode).toBe('VALIDATED')
    })
  })

  describe('stripThinkingBlocksForHistory', () => {
    it('should remove thinking blocks from history', () => {
      const messages: UnifiedMessage[] = [
        {
          role: 'assistant',
          parts: [
            { type: 'thinking', thinking: { text: 'thought', signature: 'sig' } },
            { type: 'text', text: 'response' }
          ]
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'next' }]
        }
      ]

      const result = stripThinkingBlocksForHistory(messages)
      
      expect(result.length).toBe(2)
      const first = result[0]
      if (first) {
        expect(first.parts.length).toBe(1)
        expect(first.parts[0]?.type).toBe('text')
        expect(first.parts[0]?.text).toBe('response')
      }
    })

    it('should filter out empty messages', () => {
      const messages: UnifiedMessage[] = [
        {
          role: 'assistant',
          parts: [{ type: 'thinking', thinking: { text: 'just thought', signature: 'sig' } }]
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'next' }]
        }
      ]

      const result = stripThinkingBlocksForHistory(messages)
      
      expect(result.length).toBe(1)
      const first = result[0]
      if (first) {
        expect(first.role).toBe('user')
      }
    })
  })

  describe('ensureMaxOutputTokensGreaterThanBudget', () => {
    it('should return default margin if maxTokens is undefined', () => {
      expect(ensureMaxOutputTokensGreaterThanBudget(undefined, 2048)).toBe(8192) // Min 8192
      expect(ensureMaxOutputTokensGreaterThanBudget(undefined, 8000)).toBe(9000)
    })

    it('should enforce min 8192 if possible', () => {
       expect(ensureMaxOutputTokensGreaterThanBudget(undefined, 1024)).toBe(8192)
    })

    it('should increase maxTokens if less than budget', () => {
      expect(ensureMaxOutputTokensGreaterThanBudget(4000, 4000)).toBe(5000)
      expect(ensureMaxOutputTokensGreaterThanBudget(3000, 4000)).toBe(5000)
    })

    it('should keep maxTokens if sufficient', () => {
      expect(ensureMaxOutputTokensGreaterThanBudget(10000, 4000)).toBe(10000)
    })
  })
})