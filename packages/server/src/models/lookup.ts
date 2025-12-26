import { createLogger } from '@llmux/core'
import type { CredentialProvider } from '../auth'
import { createModelCache } from './cache'
import { createFetcher } from './fetchers'
import { createModelRegistry } from './registry'
import type { ModelProvider } from './types'

const logger = createLogger({ service: 'model-lookup' })

export interface ModelLookup {
  /**
   * Get provider for a given model ID.
   * Returns the provider name if found, undefined otherwise.
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

        // Fetch models using registry
        const registry = createModelRegistry()
        const cache = createModelCache()

        for (const provider of validProviders) {
          registry.registerFetcher(provider, createFetcher(provider, { cache }))
        }

        const models = await registry.getModels(validProviders, tokens)

        // Build model → provider cache
        const newCache = new Map<string, ModelProvider>()
        for (const model of models) {
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
      return modelCache.get(modelId)
    },

    async hasModel(modelId: string): Promise<boolean> {
      await ensureInitialized()
      return modelCache.has(modelId)
    },

    async refresh(): Promise<void> {
      initialized = false
      await refresh()
    },
  }
}
