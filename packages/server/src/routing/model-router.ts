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
      const fallbacks: Array<{ provider: UpstreamProvider; model: string }> = []
      const visited = new Set<string>([model])

      visited.add(mapping.model)

      const primaryModelMapping = this.config.modelMappings[mapping.model]
      if (primaryModelMapping?.fallbacks) {
        await this.processFallbacks(primaryModelMapping.fallbacks, visited, fallbacks)
      }

      if (mapping.fallbacks) {
        await this.processFallbacks(mapping.fallbacks, visited, fallbacks)
      }

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
      const fallbacks: Array<{ provider: UpstreamProvider; model: string }> = []
      const visited = new Set<string>([model])

      visited.add(mapping.model)

      const primaryModelMapping = this.config.modelMappings[mapping.model]
      if (primaryModelMapping?.fallbacks) {
        this.processFallbacksSync(primaryModelMapping.fallbacks, visited, fallbacks)
      }

      if (mapping.fallbacks) {
        this.processFallbacksSync(mapping.fallbacks, visited, fallbacks)
      }

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

  private async processFallbacks(
    sourceFallbacks: string[],
    visited: Set<string>,
    results: Array<{ provider: UpstreamProvider; model: string }>
  ): Promise<void> {
    for (const fbModel of sourceFallbacks) {
      if (visited.has(fbModel)) continue
      visited.add(fbModel)

      // 1. Explicit provider suffix
      const { model: baseModel, provider: explicitProvider } = parseExplicitProvider(fbModel)
      if (explicitProvider) {
        results.push({ provider: explicitProvider, model: baseModel })
        continue
      }

      // 2. Mapping
      const mapping = this.config.modelMappings?.[fbModel]
      if (mapping) {
        results.push({ provider: mapping.provider, model: mapping.model })
        if (mapping.fallbacks) {
          await this.processFallbacks(mapping.fallbacks, visited, results)
        }
        continue
      }

      // 3. Lookup
      if (this.config.modelLookup) {
        try {
          const provider = await this.config.modelLookup.getProviderForModel(fbModel)
          if (provider) {
            results.push({ provider: provider as UpstreamProvider, model: fbModel })
            continue
          }
        } catch (error) {
          logger.warn({ fbModel, error }, 'ModelLookup failed during fallback resolution')
        }
      }

      logger.warn({ fbModel }, 'Fallback model not found in mappings or lookup')
    }
  }

  private processFallbacksSync(
    sourceFallbacks: string[],
    visited: Set<string>,
    results: Array<{ provider: UpstreamProvider; model: string }>
  ): void {
    for (const fbModel of sourceFallbacks) {
      if (visited.has(fbModel)) continue
      visited.add(fbModel)

      // 1. Explicit provider suffix
      const { model: baseModel, provider: explicitProvider } = parseExplicitProvider(fbModel)
      if (explicitProvider) {
        results.push({ provider: explicitProvider, model: baseModel })
        continue
      }

      // 2. Mapping
      const mapping = this.config.modelMappings?.[fbModel]
      if (mapping) {
        results.push({ provider: mapping.provider, model: mapping.model })
        if (mapping.fallbacks) {
          this.processFallbacksSync(mapping.fallbacks, visited, results)
        }
        continue
      }

      logger.warn({ fbModel }, 'Fallback model not found in mappings (Sync)')
    }
  }
}
