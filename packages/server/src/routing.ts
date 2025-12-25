import type { ProviderName } from '@llmux/core'
import type { RoutingConfig } from './config'

export interface RouteResult {
  provider: ProviderName
  model: string
}

export class Router {
  private config: RoutingConfig
  private currentIndex = 0

  constructor(config: RoutingConfig = {}) {
    this.config = config
  }

  resolveModel(requestedModel: string): RouteResult {
    if (this.config.modelMapping?.[requestedModel]) {
      const mapping = this.config.modelMapping[requestedModel]
      return {
        provider: mapping.provider,
        model: mapping.model,
      }
    }

    const provider = this.config.defaultProvider || 'openai'
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

  handleRateLimit(): ProviderName | undefined {
    if (!this.shouldRotateOn429()) return undefined
    return this.getNextProvider()
  }
}

export function createRouter(config: RoutingConfig = {}): Router {
  return new Router(config)
}
