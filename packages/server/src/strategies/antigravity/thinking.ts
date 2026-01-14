import type { ThinkingMode, ThinkingStrategyResolver } from '@llmux/core'
import { getThinkingStrategy } from '../../handlers/thinking-utils'

export class AntigravityThinkingStrategy implements ThinkingStrategyResolver {
  readonly strategyType = 'thinking'

  getMode(model: string): ThinkingMode {
    return getThinkingStrategy(model)
  }

  shouldStripSignatures(model: string): boolean {
    return this.getMode(model) === 'claude-fresh'
  }
}
