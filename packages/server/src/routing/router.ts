import type { ProviderName } from '@llmux/core'
import type { RoutingConfig } from '../config'
import { type CooldownManager, globalCooldownManager } from '../cooldown'
import type { ModelLookup } from '../models/lookup'
import { ModelRouter } from './model-router'
import type { CredentialChecker, UpstreamProvider } from './types'

export interface RouteResult {
  provider: UpstreamProvider
  model: string
}

export class Router {
  private config: RoutingConfig
  private cooldownManager: CooldownManager
  private currentIndex = 0
  private modelRouter: ModelRouter

  constructor(
    config: RoutingConfig = {},
    modelLookup?: ModelLookup,
    credentialChecker?: CredentialChecker
  ) {
    this.config = config
    this.cooldownManager = globalCooldownManager

    // Transform legacy modelMapping to new format if needed
    // routing/types.ts: UpstreamProvider = ProviderName | 'openai-web' | 'opencode-zen'
    // config.ts: ProviderName (core)
    // They are compatible as UpstreamProvider is a superset
    const modelMappings = config.modelMapping as
      | Record<
          string,
          {
            provider: UpstreamProvider
            model: string
            fallbacks?: string[]
          }
        >
      | undefined

    // Initialize ModelRouter
    this.modelRouter = new ModelRouter(
      {
        modelLookup,
        modelMappings,
        defaultProvider: config.fallbackOrder?.[0] as UpstreamProvider,
        enableOpenAIFallback: true,
      },
      credentialChecker
    )
  }

  /**
   * Resolve a model to a provider using ModelRouter logic + Cooldown management
   */
  async resolveModel(requestedModel: string): Promise<RouteResult> {
    // 1. Resolve using ModelRouter (includes explicit, mappings, lookup, inference)
    const resolution = await this.modelRouter.resolve(requestedModel)

    // 2. Check cooldown for primary choice
    const key = `${resolution.providerId}:${resolution.targetModel}`
    if (this.cooldownManager.isAvailable(key)) {
      return {
        provider: resolution.providerId as ProviderName,
        model: resolution.targetModel,
      }
    }

    // 3. Try fallbacks from resolution
    for (const fallback of resolution.fallbacks) {
      // Use the model from fallback if specified, otherwise targetModel (though fallback usually has specific model)
      const fallbackModel = fallback.model || resolution.targetModel
      const fallbackKey = `${fallback.provider}:${fallbackModel}`

      if (this.cooldownManager.isAvailable(fallbackKey)) {
        return {
          provider: fallback.provider,
          model: fallbackModel,
        }
      }
    }

    // 4. Default fallback rotation (legacy behavior if everything fails)
    if (this.config.fallbackOrder && this.config.fallbackOrder.length > 0) {
      const provider = this.config.fallbackOrder[
        this.currentIndex % this.config.fallbackOrder.length
      ] as UpstreamProvider
      if (provider) {
        return {
          provider,
          model: requestedModel,
        }
      }
    }

    // Return primary if everything else fails
    return {
      provider: resolution.providerId,
      model: resolution.targetModel,
    }
  }

  getNextProvider(): ProviderName | undefined {
    const order = this.config.fallbackOrder
    if (!order || order.length === 0) return undefined

    const provider = order[this.currentIndex % order.length]
    this.currentIndex++
    return provider
  }

  resetRotation(): void {
    this.currentIndex = 0
  }

  shouldRotateOn429(): boolean {
    return this.config.rotateOn429 ?? false
  }

  getMaxRetryAttempts(): number {
    return this.config.maxRetryAttempts ?? 20
  }

  handleRateLimit(model: string, retryAfterMs?: number): void {
    // We need the provider to mark rate limit correctly.
    // Ideally this method should accept provider.
    // For now, we try to resolve synchronously to guess the provider?
    // Or we just mark the model if we can't determine provider.
    // The previous implementation looked up mapping.

    if (this.config.modelMapping?.[model]) {
      const mapping = this.config.modelMapping[model]
      const key = `${mapping.provider}:${mapping.model}`
      this.cooldownManager.markRateLimited(key, retryAfterMs)
    }

    // Attempt sync resolution
    const result = this.modelRouter.resolveSync(model)
    const key = `${result.providerId}:${result.targetModel}`
    this.cooldownManager.markRateLimited(key, retryAfterMs)
  }
}

export function createRouter(
  config: RoutingConfig = {},
  modelLookup?: ModelLookup,
  credentialChecker?: CredentialChecker
): Router {
  return new Router(config, modelLookup, credentialChecker)
}
