import type { ThinkingConfig, UnifiedMessage } from '../../../types/unified.js'

import type { AntigravityToolConfig, ClaudeGenerationConfig } from './types.js'

/**
 * US-004: Antigravity Claude-specific Transforms
 */

export function buildClaudeThinkingConfig(
  thinking?: ThinkingConfig
): ClaudeGenerationConfig['thinking_config'] | undefined {
  if (!thinking?.enabled) {
    return undefined
  }

  return {
    include_thoughts: thinking.includeThoughts ?? true,
    thinking_budget: thinking.budget || 2048, // Default budget if missing (though strictly required by Claude)
  }
}

export function configureClaudeToolConfig(): AntigravityToolConfig {
  return {
    function_calling_config: {
      mode: 'VALIDATED',
    },
  }
}

/**
 * Claude는 히스토리에서 Thinking 블록을 제거하는 것을 권장합니다.
 * (Signature 불필요, Context 절약)
 */
export function stripThinkingBlocksForHistory(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages
    .map((msg) => ({
      ...msg,
      parts: msg.parts.filter((p) => p.type !== 'thinking'),
    }))
    .filter((msg) => msg.parts.length > 0) // 빈 메시지 제거 (옵션)
}

export function ensureMaxOutputTokensGreaterThanBudget(
  maxTokens: number | undefined,
  thinkingBudget: number
): number {
  if (maxTokens === undefined) {
    return Math.max(thinkingBudget + 1000, 8192) // Default safe margin
  }
  if (maxTokens <= thinkingBudget) {
    return thinkingBudget + 1000 // Force increase
  }
  return maxTokens
}
