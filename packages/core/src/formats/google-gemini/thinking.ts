import type { UnifiedRequest } from '../../types/unified'
import type { GeminiGenerationConfig } from './types'

/**
 * Apply thinking configuration to Gemini GenerationConfig.
 * This is a local version of applyThinkingConfig specifically for Gemini format.
 *
 * @param unified The unified request object (source of truth for thinking config)
 * @param targetConfig The Gemini GenerationConfig object to modify in-place
 */
export function applyThinkingConfigLocal(
  unified: UnifiedRequest,
  targetConfig: GeminiGenerationConfig
): void {
  const config = unified.thinking

  // Handle explicitly disabled thinking
  if (config && config.enabled === false) {
    targetConfig.thinkingConfig = {
      includeThoughts: false,
      // For Gemini 3 compatibility
      ...(config.level && {
        thinkingLevel: config.level.toUpperCase() as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
      }),
    }
    // Also explicitly zero budget if needed by some backends
    if (config.budget !== undefined) {
      targetConfig.thinkingConfig.thinkingBudget = 0
    }
    return
  }

  if (!config || !config.enabled) {
    return
  }

  // Gemini thinking configuration
  const thinkingConfig: GeminiGenerationConfig['thinkingConfig'] = {
    includeThoughts: config.includeThoughts ?? true,
  }

  // Thinking level (Gemini 3 specific)
  if (config.level) {
    thinkingConfig.thinkingLevel = config.level.toUpperCase() as
      | 'MINIMAL'
      | 'LOW'
      | 'MEDIUM'
      | 'HIGH'
  }

  // Thinking budget (Gemini 2.5 specific, or generic)
  if (config.budget) {
    thinkingConfig.thinkingBudget = config.budget
  }

  targetConfig.thinkingConfig = thinkingConfig
}
