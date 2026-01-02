import { createLogger } from '@llmux/core'
import { inferProviderFromModel, isOpenAIModel, parseExplicitProvider } from './model-rules'
import type {
  CredentialChecker,
  ModelResolution,
  ModelRouterConfig,
  UpstreamProvider,
} from './types'

const logger = createLogger({ service: 'model-router' })

export class ModelRouter {
  private config: ModelRouterConfig
  private credentialChecker?: CredentialChecker

  constructor(config: ModelRouterConfig = {}, credentialChecker?: CredentialChecker) {
    this.config = {
      enableOpenAIFallback: true,
      ...config,
    }
    this.credentialChecker = credentialChecker
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
      // Resolve fallbacks to { provider, model } structure
      const fallbacks = (mapping.fallbacks || []).map((fbModel) => {
        const fbMapping = this.config.modelMappings?.[fbModel]
        if (fbMapping) {
          return { provider: fbMapping.provider, model: fbMapping.model }
        }
        // Fallback to inference if not mapped
        return { provider: inferProviderFromModel(fbModel), model: fbModel }
      })

      return {
        providerId: mapping.provider,
        targetModel: mapping.model,
        fallbacks,
        source: 'mapping',
      }
    }

    // 3. ModelLookup (Dynamic registry lookup)
    if (this.config.modelLookup) {
      try {
        const lookupProvider = await this.config.modelLookup.getProviderForModel(model)
        if (lookupProvider) {
          // If OpenAI model found, apply credential fallback logic
          if (lookupProvider === 'openai' && this.config.enableOpenAIFallback) {
            const fallbackResult = await this.resolveOpenAIFallbacks(model)
            return {
              ...fallbackResult,
              source: 'lookup', // Still considered lookup as it was found there
            }
          }

          return {
            providerId: lookupProvider as UpstreamProvider,
            targetModel: model,
            fallbacks: [],
            source: 'lookup',
          }
        }
      } catch (error) {
        logger.warn({ model, error }, 'ModelLookup failed, falling back to inference')
      }
    }

    // 4. Prefix-based inference (Fallback)
    const inferredProvider = inferProviderFromModel(model)

    // Apply OpenAI credential fallback for inferred OpenAI models
    if (
      this.config.enableOpenAIFallback &&
      (inferredProvider === 'openai' || isOpenAIModel(model))
    ) {
      const fallbackResult = await this.resolveOpenAIFallbacks(model)
      return {
        ...fallbackResult,
        source: 'inference',
      }
    }

    return {
      providerId: inferredProvider,
      targetModel: model,
      fallbacks: [],
      source: 'inference',
    }
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
      const fallbacks = (mapping.fallbacks || []).map((fbModel) => {
        const fbMapping = this.config.modelMappings?.[fbModel]
        if (fbMapping) {
          return { provider: fbMapping.provider, model: fbMapping.model }
        }
        return { provider: inferProviderFromModel(fbModel), model: fbModel }
      })

      return {
        providerId: mapping.provider,
        targetModel: mapping.model,
        fallbacks,
        source: 'mapping',
      }
    }

    // 3. Prefix-based inference
    const inferredProvider = inferProviderFromModel(model)

    return {
      providerId: inferredProvider,
      targetModel: model,
      fallbacks: [],
      source: 'inference',
    }
  }

  /**
   * Resolves OpenAI vs OpenAI-web based on available credentials
   */
  private async resolveOpenAIFallbacks(model: string): Promise<ModelResolution> {
    if (!this.credentialChecker) {
      return {
        providerId: 'openai',
        targetModel: model,
        fallbacks: [],
        source: 'inference',
      }
    }

    const [hasOpenAI, hasOpenAIWeb] = await Promise.all([
      this.credentialChecker.hasCredential('openai'),
      this.credentialChecker.hasCredential('openai-web'),
    ])

    // Both available - prefer openai-web with openai fallback
    if (hasOpenAI && hasOpenAIWeb) {
      return {
        providerId: 'openai-web',
        targetModel: model,
        fallbacks: [{ provider: 'openai', model }],
        source: 'inference',
      }
    }

    // Only openai-web available
    if (!hasOpenAI && hasOpenAIWeb) {
      return {
        providerId: 'openai-web',
        targetModel: model,
        fallbacks: [],
        source: 'inference',
      }
    }

    // Only openai available OR neither available (default)
    return {
      providerId: 'openai',
      targetModel: model,
      fallbacks: [],
      source: 'inference',
    }
  }
}
