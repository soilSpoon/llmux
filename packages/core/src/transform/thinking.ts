import type { ProviderName } from '../providers/base'
import type { UnifiedRequest } from '../types/unified'

/**
 * Apply thinking configuration to provider-specific request structures.
 * This ensures consistent thinking/reasoning behavior across different providers
 * by mapping the unified ThinkingConfig to each provider's specific fields.
 *
 * @param unified The unified request object (source of truth for thinking config)
 * @param provider The target provider name
 * @param targetRequest The target provider's request object to modify in-place
 */
export function applyThinkingConfig<T extends object>(
  unified: UnifiedRequest,
  provider: ProviderName,
  targetRequest: T
): void {
  const target = targetRequest as Record<string, unknown>
  const config = unified.thinking

  // Handle explicitly disabled thinking
  if (config && config.enabled === false) {
    switch (provider) {
      case 'anthropic':
        target.thinking = { type: 'disabled' }
        return
      case 'gemini':
      case 'google':
        target.thinkingConfig = {
          includeThoughts: false,
          thinkingBudget: 0,
          ...(config.level && { thinkingLevel: config.level.toUpperCase() }),
        }
        return
      default:
        return
    }
  }

  if (!config || !config.enabled) {
    if (provider === 'anthropic' && target.thinking) {
      delete target.thinking
    }
    return
  }

  switch (provider) {
    case 'openai': {
      if (config.effort) {
        target.reasoning_effort = config.effort
      }
      if (config.includeThoughts) {
        const include = (target.include as string[]) || []
        if (!include.includes('reasoning.encrypted_content')) {
          include.push('reasoning.encrypted_content')
        }
        target.include = include
      }
      break
    }

    case 'anthropic': {
      const budget = config.budget ?? 1024
      target.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      }

      const maxTokens = target.max_tokens as number | undefined
      if (maxTokens && maxTokens <= budget) {
        target.max_tokens = budget + 4096
      }
      break
    }

    case 'gemini':
    case 'google': {
      const thinkingConfig: Record<string, unknown> = {
        includeThoughts: config.includeThoughts ?? true,
      }
      if (config.level) {
        thinkingConfig.thinkingLevel = config.level.toUpperCase()
      }
      if (config.budget) {
        thinkingConfig.thinkingBudget = config.budget
      }
      target.thinkingConfig = thinkingConfig
      break
    }

    case 'antigravity': {
      const antigravityConfig: Record<string, unknown> = {
        include_thoughts: config.includeThoughts ?? true,
      }
      if (config.budget) {
        antigravityConfig.budget_tokens = config.budget
      }
      target.thinking_config = antigravityConfig
      break
    }

    default:
      break
  }
}
