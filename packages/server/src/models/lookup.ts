import {
  type AuthType,
  createLogger,
  getProvider,
  hasProvider,
  type ProviderName,
} from '@llmux/core'
import type { CredentialProvider } from '../auth'
import { createModelCache } from './cache'
import { createFetcher } from './fetchers'
import { createModelRegistry } from './registry'
import type { ModelProvider } from './types'

const logger = createLogger({ service: 'model-lookup' })

/**
 * Get authType for a provider. Returns 'apiKey' as default if not found.
 */
function getProviderAuthType(provider: ModelProvider): AuthType {
  try {
    if (hasProvider(provider as ProviderName)) {
      const p = getProvider(provider as ProviderName)
      return p.config.authType ?? 'apiKey'
    }
  } catch {
    // Provider not registered in core, default to apiKey
  }
  return 'apiKey'
}

export interface ModelLookup {
  /**
   * Get provider for a given model ID.
   * Returns the provider name if found, undefined otherwise.
   * Supports prefix matching.
   */
  getProviderForModel(modelId: string): Promise<ModelProvider | undefined>

  /**
   * Check if a model ID is available in any registered provider.
   */
  hasModel(modelId: string): Promise<boolean>

  /**
   * Force refresh the model cache.
   */
  refresh(): Promise<void>
}

/**
 * Find provider for a model using prefix matching.
 * Exported for testing.
 */
export function findProviderByPrefix(
  modelId: string,
  modelCache: Map<string, ModelProvider>
): ModelProvider | undefined {
  // 1. Exact match first
  const exactMatch = modelCache.get(modelId)
  if (exactMatch) {
    return exactMatch
  }

  // 2. Prefix matching - find all matching models
  const matches: Array<{ modelId: string; provider: ModelProvider }> = []
  for (const [cachedModelId, provider] of modelCache) {
    // Check if request model starts with cached model or vice versa
    if (modelId.startsWith(cachedModelId) || cachedModelId.startsWith(modelId)) {
      matches.push({ modelId: cachedModelId, provider })
    }
  }

  // If multiple matches with different providers, don't match (ambiguous)
  if (matches.length > 1) {
    const uniqueProviders = new Set(matches.map((m) => m.provider))
    if (uniqueProviders.size > 1) {
      logger.debug(
        { requestedModel: modelId, matchCount: matches.length, providers: [...uniqueProviders] },
        'Ambiguous prefix match - multiple providers found'
      )
      return undefined
    }
  }

  // Single match or multiple matches from same provider - use longest match
  if (matches.length > 0) {
    const bestMatch = matches.reduce((best, current) =>
      current.modelId.length > best.modelId.length ? current : best
    )
    logger.debug(
      { requestedModel: modelId, matchedModel: bestMatch.modelId, provider: bestMatch.provider },
      'Prefix match found'
    )
    return bestMatch.provider
  }

  return undefined
}

export function createModelLookup(credentialProvider: CredentialProvider): ModelLookup {
  let modelCache: Map<string, ModelProvider> = new Map()
  let initialized = false
  let refreshPromise: Promise<void> | null = null

  async function ensureInitialized(): Promise<void> {
    if (initialized) return
    if (refreshPromise) {
      await refreshPromise
      return
    }
    await refresh()
  }

  async function refresh(): Promise<void> {
    if (refreshPromise) {
      await refreshPromise
      return
    }

    refreshPromise = (async () => {
      try {
        const credentials = await credentialProvider.getAllCredentials()
        const providers = Object.keys(credentials) as ModelProvider[]

        if (providers.length === 0) {
          logger.debug('No providers with credentials found')
          initialized = true
          return
        }

        // Build tokens map
        const tokens: Record<string, string> = {}
        const validProviders: ModelProvider[] = []
        for (const provider of providers) {
          try {
            const token = await credentialProvider.getAccessToken(provider)
            if (token) {
              tokens[provider] = token
            }
            validProviders.push(provider)
          } catch {
            // Skip provider if token retrieval fails
          }
        }

        // Add gemini-cli as a virtual provider if antigravity credentials exist
        // gemini-cli uses the same OAuth credentials as antigravity but routes to different models
        if (
          providers.includes('antigravity' as ModelProvider) &&
          !validProviders.includes('gemini-cli' as ModelProvider)
        ) {
          validProviders.push('gemini-cli' as ModelProvider)
          // gemini-cli doesn't need a token in the tokens map - it reuses antigravity credentials
        }

        // Fetch models using registry
        const registry = createModelRegistry()
        const cache = createModelCache()

        for (const provider of validProviders) {
          registry.registerFetcher(provider, createFetcher(provider, { cache }))
        }

        const models = await registry.getModels(validProviders, tokens)

        // Build model → provider cache with OAuth priority
        // When same model exists in multiple providers, OAuth providers take precedence
        const newCache = new Map<string, ModelProvider>()
        for (const model of models) {
          const existingProvider = newCache.get(model.id)
          if (existingProvider) {
            const existingAuthType = getProviderAuthType(existingProvider)
            const newAuthType = getProviderAuthType(model.provider)
            // OAuth takes priority over apiKey
            if (existingAuthType === 'oauth' && newAuthType === 'apiKey') {
              continue // Keep existing OAuth provider
            }
            if (existingAuthType === 'apiKey' && newAuthType === 'oauth') {
              logger.debug(
                { modelId: model.id, oldProvider: existingProvider, newProvider: model.provider },
                'OAuth provider taking priority over apiKey provider'
              )
            }
          }
          newCache.set(model.id, model.provider)
        }

        modelCache = newCache
        initialized = true

        logger.info(
          { modelCount: modelCache.size, providers: validProviders },
          'Model lookup cache initialized'
        )
      } finally {
        refreshPromise = null
      }
    })()

    await refreshPromise
  }

  return {
    async getProviderForModel(modelId: string): Promise<ModelProvider | undefined> {
      await ensureInitialized()
      return findProviderByPrefix(modelId, modelCache)
    },

    async hasModel(modelId: string): Promise<boolean> {
      await ensureInitialized()
      const provider = await this.getProviderForModel(modelId)
      return provider !== undefined
    },

    async refresh(): Promise<void> {
      initialized = false
      await refresh()
    },
  }
}
