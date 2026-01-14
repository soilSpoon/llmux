/**
 * Antigravity Provider Strategies
 *
 * Implements provider-specific strategies for Antigravity to enable
 * handler layer to remain provider-agnostic.
 */

import { createLogger } from '@llmux/core'
import type {
  MetadataInjectionStrategy,
  PrepareUpstreamOptions,
  RateLimitContext,
  RateLimitStrategy,
  RequestMetadataInjection,
  ThinkingMode,
  ThinkingStrategyResolver,
  UpstreamContext,
  UpstreamPreparationStrategy,
} from '@llmux/core/types/provider-strategies'
import { prepareAntigravityRequest } from './antigravity'

const logger = createLogger({ service: 'antigravity-strategies' })

// ═══════════════════════════════════════════════════════════════════════════════
// UPSTREAM PREPARATION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Antigravity upstream preparation strategy
 *
 * Handles:
 * - OAuth credential rotation
 * - Project ID resolution (stored, fetched, or override)
 * - Endpoint selection with fallback support
 * - Streaming vs non-streaming header generation
 */
export class AntigravityUpstreamStrategy implements UpstreamPreparationStrategy {
  readonly strategyType = 'upstream' as const

  async prepare(options: PrepareUpstreamOptions): Promise<UpstreamContext> {
    const { model, accountIndex, overrideProjectId, streaming, reqId, retryEndpointIndex } = options

    logger.debugTemp(
      { reqId, model, accountIndex },
      'AntigravityUpstreamStrategy: preparing context'
    )

    const context = await prepareAntigravityRequest({
      model,
      accountIndex,
      overrideProjectId: overrideProjectId || null,
      streaming,
      reqId,
      provider: 'antigravity',
      retryEndpointIndex,
    })

    if (!context) {
      throw new Error('Failed to prepare Antigravity context: no credentials available')
    }

    return {
      accountIndex: context.accountIndex,
      projectId: context.projectId,
      endpoint: context.endpoint,
      headers: context.headers,
      account: context.account,
      providerInfo: {
        antigravity: {
          endpoint: context.endpoint,
          account: context.account,
        },
      },
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THINKING STRATEGY RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Claude Fresh thinking strategy
 *
 * Claude Fresh signature mode strips ALL thinking blocks and signatures
 * unconditionally, without project validation.
 */
export class ClaudeFreshThinkingStrategy implements ThinkingStrategyResolver {
  readonly strategyType = 'thinking' as const

  getMode(model: string): ThinkingMode {
    const lowerModel = model.toLowerCase()

    // Claude Fresh models use unconditional signature stripping
    if (lowerModel.includes('claude')) {
      return 'claude-fresh'
    }

    // Gemini models use cache-based validation
    if (lowerModel.includes('gemini')) {
      return 'gemini-cache'
    }

    return 'standard'
  }

  shouldStripSignatures(model: string): boolean {
    return this.getMode(model) === 'claude-fresh'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA INJECTION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Antigravity metadata injection strategy
 *
 * Injects Antigravity-specific metadata fields:
 * - project: GCP project ID
 * - model: Model name
 * - requestId: Request ID for tracing
 */
export class AntigravityMetadataStrategy implements MetadataInjectionStrategy {
  readonly strategyType = 'metadata' as const

  requiresInjection(_model: string): boolean {
    // Antigravity always requires metadata injection
    return true
  }

  getMetadata(options: {
    model: string
    projectId?: string
    requestId?: string
  }): RequestMetadataInjection {
    return {
      project: options.projectId,
      model: options.model,
      requestId: options.requestId,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMIT STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Claude Weekly Limit strategy
 *
 * Detects Claude weekly limits on Antigravity (specific quota type).
 */
export class ClaudeWeeklyLimitStrategy implements RateLimitStrategy {
  readonly strategyType = 'rateLimit' as const

  private readonly WEEKLY_LIMIT_MODELS = [
    'claude-sonnet-4-5',
    'claude-sonnet-3-7',
    'claude-opus-4-5',
    'claude-opus-3-7',
  ]

  getContext(options: {
    model: string
    family?: string
    retryAfterMs?: number
    accountIndex?: number
    endpointIndex?: number
  }): RateLimitContext {
    const { model, family, retryAfterMs, endpointIndex } = options

    const isWeeklyLimit = family === 'claude' && this.isWeeklyLimitModel(model)

    return {
      isWeeklyLimit,
      limitType: isWeeklyLimit ? 'hard' : 'soft',
      family,
      retryAfterMs,
      endpointIndex,
    }
  }

  private isWeeklyLimitModel(model: string): boolean {
    const lowerModel = model.toLowerCase()
    return this.WEEKLY_LIMIT_MODELS.some((m) => lowerModel.includes(m.toLowerCase()))
  }
}
