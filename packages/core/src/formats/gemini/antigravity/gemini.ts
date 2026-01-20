import type { ThinkingConfig } from '../../../types/unified.js'
import type { GeminiGenerationConfig } from './types.js'

/**
 * US-005: Antigravity Gemini-specific Transforms
 */

export function buildGeminiThinkingConfig(
  thinking: ThinkingConfig | undefined,
  style: 'budget' | 'level'
): GeminiGenerationConfig['thinking_config'] | undefined {
  if (!thinking?.enabled) {
    return undefined
  }

  if (style === 'budget') {
    let budget = thinking.budget || 8192

    if (!thinking.budget && thinking.effort) {
      switch (thinking.effort) {
        case 'low':
          budget = 8192
          break
        case 'medium':
          budget = 16384
          break
        case 'high':
          budget = 32768
          break
      }
    }

    return {
      include_thoughts: true,
      thinking_budget: budget,
    }
  }

  if (style === 'level') {
    const levelMap: Record<string, 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'> = {
      minimal: 'MINIMAL',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
    }

    let level = thinking.level ? levelMap[thinking.level] : 'LOW'

    if (!thinking.level && thinking.budget) {
      if (thinking.budget >= 32768) level = 'HIGH'
      else if (thinking.budget >= 16384) level = 'MEDIUM'
      else level = 'LOW'
    }

    return {
      include_thoughts: true,
      thinking_level: level || 'LOW',
    }
  }

  return undefined
}
