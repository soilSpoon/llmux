/**
 * Thinking module barrel exports
 */

export * from './claude-fresh-strategy'
export * from './gemini-cache-strategy'
export * from './noop-strategy'
export * from './thinking-strategy'

import { getThinkingStrategy as getStrategyName } from '../thinking-utils'
import type { ThinkingStrategy } from './thinking-strategy'
import { getThinkingStrategyByName } from './thinking-strategy'

export function getThinkingStrategyForModel(model?: string, provider?: string): ThinkingStrategy {
  const name = getStrategyName(model, provider)
  const strategy = getThinkingStrategyByName(name)
  if (!strategy) {
    const noop = getThinkingStrategyByName('none')
    if (!noop) {
      throw new Error(`No thinking strategy found for: ${name}`)
    }
    return noop
  }
  return strategy
}
