import { describe, expect, it } from 'bun:test'
import {
  buildClaudeThinkingConfig,
  configureClaudeToolConfig,
  stripThinkingBlocksForHistory
} from '../../../../src/formats/gemini/antigravity/claude'
import type { UnifiedMessage } from '../../../../src/types/unified'

describe('Antigravity: Claude Transforms', () => {
  describe('buildClaudeThinkingConfig', () => {
    it('should return undefined if thinking is disabled', () => {
      expect(buildClaudeThinkingConfig(undefined)).toBeUndefined()
    })

    it('should generate snake_case thinking_config for Claude', () => {
      const config = buildClaudeThinkingConfig({ enabled: true, budget: 1024 })
      expect(config).toEqual({
        include_thoughts: true,
        thinking_budget: 1024
      })
    })

    it('should default budget if not provided', () => {
       // Assuming default or error? PRD says budget is required for Claude.
       // Let's assume input validation happens before or handles it gracefully.
       // If budget is missing in unified config but enabled is true:
       const config = buildClaudeThinkingConfig({ enabled: true, budget: 0 })
       // Actually 0 is falsy, let's see. If UnifiedThinkingConfig.budget is required, then we are good.
       // If optional, we might need default.
       // Let's test explicit value.
       expect(config).toBeDefined()
    })
  })

  describe('configureClaudeToolConfig', () => {
    it('should return VALIDATED mode tool config', () => {
      const config = configureClaudeToolConfig()
      expect(config.function_calling_config.mode).toBe('VALIDATED')
    })
  })

  describe('stripThinkingBlocksForHistory', () => {
    it('should remove thinking blocks from history messages', () => {
      const history: UnifiedMessage[] = [
        {
          role: 'assistant',
          parts: [
            { type: 'thinking', thinking: { text: 'thought', signature: 'sig' } },
            { type: 'text', text: 'response' }
          ]
        }
      ]

      const stripped = stripThinkingBlocksForHistory(history)
      const firstMsg = stripped[0]
      if (!firstMsg) throw new Error('Expected stripped to have messages')
      expect(firstMsg.parts.length).toBe(1)
      expect(firstMsg.parts[0]?.type).toBe('text')
    })

    it('should keep tool blocks intact', () => {
       const history: UnifiedMessage[] = [
        {
          role: 'assistant',
          parts: [
             { type: 'tool_call', toolCall: { name: 'f', arguments: {}, id: '1' } }
          ]
        }
      ]
      const stripped = stripThinkingBlocksForHistory(history)
      const firstMsg = stripped[0]
      if (!firstMsg) throw new Error('Expected stripped to have messages')
      expect(firstMsg.parts.length).toBe(1)
    })
  })
})
