import { createLogger } from '@llmux/core'
import type { Model, ModelFetcher, ModelProvider } from './types'

const logger = createLogger({ service: 'model-registry' })

export interface ModelRegistry {
  registerFetcher(provider: ModelProvider, fetcher: ModelFetcher): void
  hasFetcher(provider: ModelProvider): boolean
  getModels(providers: ModelProvider[], tokens?: Record<string, string>): Promise<Model[]>
}

export function createModelRegistry(): ModelRegistry {
  const fetchers = new Map<ModelProvider, ModelFetcher>()

  return {
    registerFetcher(provider: ModelProvider, fetcher: ModelFetcher): void {
      fetchers.set(provider, fetcher)
    },

    hasFetcher(provider: ModelProvider): boolean {
      return fetchers.has(provider)
    },

    async getModels(providers: ModelProvider[], tokens?: Record<string, string>): Promise<Model[]> {
      const fetchPromises = providers.map(async (provider) => {
        const fetcher = fetchers.get(provider)
        if (!fetcher) {
          return []
        }

        try {
          const token = tokens?.[provider]
          return await fetcher.fetchModels(token)
        } catch (error) {
          logger.error(
            { provider, error: error instanceof Error ? error.message : String(error) },
            'Failed to fetch models'
          )
          return []
        }
      })

      const allModels = await Promise.all(fetchPromises)
      return allModels.flat()
    },
  }
}
