import { createLogger } from '@llmux/core'
import { parseExplicitProvider } from './model-rules'
import type { ModelResolution, ModelRouterConfig, UpstreamProvider } from './types'

const logger = createLogger({ service: 'model-router' })

export class ModelRouter {
  private config: ModelRouterConfig

  constructor(config: ModelRouterConfig = {}) {
    this.config = config
  }

  /**
   * Resolves a model to a provider using all available strategies
   */
  async resolve(model: string): Promise<ModelResolution> {
    // 1. Explicit provider suffix (model:provider)
    const { model: baseModel, provider: explicitProvider } = parseExplicitProvider(model)
    if (explicitProvider) {
      return {
        providerId: explicitProvider,
        targetModel: baseModel,
        fallbacks: [],
        source: 'explicit',
      }
    }

    // 2. Static config mapping
    if (this.config.modelMappings?.[model]) {
      const mapping = this.config.modelMappings[model]
      const fallbacks = (mapping.fallbacks || [])
        .map((fbModel) => {
          const fbMapping = this.config.modelMappings?.[fbModel]
          if (fbMapping) {
            return { provider: fbMapping.provider, model: fbMapping.model }
          }
          // Fallback must be in mappings, otherwise skip
          logger.warn({ fbModel }, 'Fallback model not found in mappings, skipping')
          return null
        })
        .filter((fb): fb is { provider: UpstreamProvider; model: string } => fb !== null)

      return {
        providerId: mapping.provider,
        targetModel: mapping.model,
        fallbacks,
        source: 'mapping',
      }
    }

    // 3. ModelLookup (Dynamic registry lookup from /models)
    if (this.config.modelLookup) {
      try {
        const lookupProvider = await this.config.modelLookup.getProviderForModel(model)
        if (lookupProvider) {
          return {
            providerId: lookupProvider as UpstreamProvider,
            targetModel: model,
            fallbacks: [],
            source: 'lookup',
          }
        }
      } catch (error) {
        logger.warn({ model, error }, 'ModelLookup failed')
      }
    }

    // 4. No provider found - throw error (no default fallback)
    throw new Error(
      `No provider found for model: ${model}. Configure modelMappings or ensure ModelLookup is available.`
    )
  }

  /**
   * Synchronous resolution using only static rules (no async ModelLookup)
   * Use this when async execution is not possible or desired
   */
  resolveSync(model: string): ModelResolution {
    // 1. Explicit provider suffix
    const { model: baseModel, provider: explicitProvider } = parseExplicitProvider(model)
    if (explicitProvider) {
      return {
        providerId: explicitProvider,
        targetModel: baseModel,
        fallbacks: [],
        source: 'explicit',
      }
    }

    // 2. Static config mapping
    if (this.config.modelMappings?.[model]) {
      const mapping = this.config.modelMappings[model]
      const fallbacks = (mapping.fallbacks || [])
        .map((fbModel) => {
          const fbMapping = this.config.modelMappings?.[fbModel]
          if (fbMapping) {
            return { provider: fbMapping.provider, model: fbMapping.model }
          }
          return null
        })
        .filter((fb): fb is { provider: UpstreamProvider; model: string } => fb !== null)

      return {
        providerId: mapping.provider,
        targetModel: mapping.model,
        fallbacks,
        source: 'mapping',
      }
    }

    // 3. No provider found - throw error
    throw new Error(`No provider found for model: ${model}. Configure modelMappings.`)
  }
}
