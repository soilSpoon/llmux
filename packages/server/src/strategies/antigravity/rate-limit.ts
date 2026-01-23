import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from '@llmux/auth'
import type { RateLimitContext, RateLimitStrategy } from '@llmux/core'
import { getModelFamily, isClaudeWeeklyLimit } from '../../handlers/rate-limit-store'

export class AntigravityRateLimitStrategy implements RateLimitStrategy {
  readonly strategyType = 'rateLimit'

  getContext(options: {
    model: string
    family?: string
    retryAfterMs?: number
    accountIndex?: number
    endpointIndex?: number
  }): RateLimitContext {
    const { model, family: providedFamily, retryAfterMs, endpointIndex } = options

    // Determine model family if not provided
    const family = providedFamily || getModelFamily(model, 'antigravity')

    // Check for weekly limit semantics (Claude on Antigravity)
    const isWeeklyLimit = family === 'claude' && isClaudeWeeklyLimit(model)

    // Determine limit type
    const limitType = isWeeklyLimit ? 'hard' : retryAfterMs ? 'soft' : 'unknown'

    // Resolve endpoint for debug context
    let endpoint: string | undefined
    if (
      endpointIndex !== undefined &&
      ANTIGRAVITY_ENDPOINT_FALLBACKS &&
      endpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length
    ) {
      endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[endpointIndex]
    }

    return {
      isWeeklyLimit,
      limitType,
      family,
      retryAfterMs,
      endpointIndex,
      endpoint,
    }
  }
}
