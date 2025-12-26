import type { ModelCache } from '../cache'
import type { Model, ModelFetcher, ModelProvider } from '../types'

export const MODELS_DEV_API_URL = 'https://models.dev/api.json'

interface ModelsDevModel {
  id: string
  name: string
  family?: string
  release_date: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  limit: {
    context: number
    output: number
  }
  cost?: {
    input: number
    output: number
  }
  options: Record<string, unknown>
}

interface ModelsDevProvider {
  id: string
  name: string
  env: string[]
  api?: string
  npm?: string
  models: Record<string, ModelsDevModel>
}

type ModelsDevResponse = Record<string, ModelsDevProvider>

export function createModelsDevFetcher(provider: ModelProvider, cache?: ModelCache): ModelFetcher {
  return {
    async fetchModels(_accessToken?: string): Promise<Model[]> {
      if (cache) {
        const isExpired = await cache.isExpired(provider)
        if (!isExpired) {
          const cached = await cache.get(provider)
          if (cached) {
            return cached
          }
        }
      }

      try {
        const response = await fetch(MODELS_DEV_API_URL, {
          headers: {
            'User-Agent': 'llmux/1.0',
          },
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          return []
        }

        const data = (await response.json()) as ModelsDevResponse
        const providerData = data[provider]

        if (!providerData || !providerData.models) {
          return []
        }

        const models: Model[] = Object.values(providerData.models).map((m) => ({
          id: m.id,
          provider,
          name: m.name,
          object: 'model' as const,
          context_length: m.limit.context,
          max_completion_tokens: m.limit.output,
          owned_by: providerData.name.toLowerCase(),
        }))

        if (cache) {
          await cache.set(provider, models)
        }

        return models
      } catch {
        return []
      }
    },
  }
}
