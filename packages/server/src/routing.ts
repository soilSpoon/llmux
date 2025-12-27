import type { ProviderName } from '@llmux/core'
import type { RoutingConfig } from './config'
import { CooldownManager } from './cooldown'

export interface RouteResult {
  provider: ProviderName
  model: string
}

export class Router {
  private config: RoutingConfig
  private cooldownManager: CooldownManager
  private currentIndex = 0

  constructor(config: RoutingConfig = {}, cooldownManager?: CooldownManager) {
    this.config = config
    this.cooldownManager = cooldownManager || new CooldownManager()
  }

  resolveModel(requestedModel: string): RouteResult {
    // 1. Check direct mapping
    if (this.config.modelMapping?.[requestedModel]) {
      const mapping = this.config.modelMapping[requestedModel]
      const key = `${mapping.provider}:${mapping.model}`

      // If primary is available, use it
      if (this.cooldownManager.isAvailable(key)) {
        return {
          provider: mapping.provider,
          model: mapping.model,
        }
      }

      // 2. Check fallbacks if primary is cooled down
      if (mapping.fallbacks && mapping.fallbacks.length > 0) {
        for (const fallbackModel of mapping.fallbacks) {
          // If fallback is another mapped model
          if (this.config.modelMapping[fallbackModel]) {
            const fallbackMapping = this.config.modelMapping[fallbackModel]
            const fallbackKey = `${fallbackMapping.provider}:${fallbackMapping.model}`
            if (this.cooldownManager.isAvailable(fallbackKey)) {
              return {
                provider: fallbackMapping.provider,
                model: fallbackMapping.model,
              }
            }
          }
          // If fallback is just a model name (assume same provider or default behavior?)
          // For now, we strictly require fallbacks to be mapped or we might loop incorrectly.
          // Let's assume strict mapping for robust routing.
        }
      }

      // If all fallbacks failed, we might still return the primary (and let it fail/retry)
      // or return the first fallback?
      // Current decision: return primary if everything is down, to at least attempt request
      return {
        provider: mapping.provider,
        model: mapping.model,
      }
    }

    // 3. Default fallback rotation (existing logic)
    const provider = this.config.fallbackOrder?.[0] || 'openai'
    return {
      provider,
      model: requestedModel,
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

  handleRateLimit(model: string, retryAfterMs?: number): void {
    // Find provider for model to construct key
    // This is a bit tricky if we only have model name.
    //Ideally handleRateLimit should take provider too or we look it up.
    // For mapped models:
    if (this.config.modelMapping?.[model]) {
      const mapping = this.config.modelMapping[model]
      const key = `${mapping.provider}:${mapping.model}`
      this.cooldownManager.markRateLimited(key, retryAfterMs)
    }

    // What if it's not mapped? (e.g. passthrough)
    // unique key?
  }
}

export function createRouter(config: RoutingConfig = {}): Router {
  return new Router(config)
}
