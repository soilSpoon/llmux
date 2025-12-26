import type { Model, ModelFetcher, ModelProvider } from './types'

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
          console.error(`Failed to fetch models for ${provider}:`, error)
          return []
        }
      })

      const allModels = await Promise.all(fetchPromises)
      return allModels.flat()
    },
  }
}
