import type { ModelCache } from '../cache'
import type { Model, ModelFetcher, ModelProvider } from '../types'

export const CODEX_MODELS_URL =
  'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/models.json'

interface CodexModelInfo {
  slug: string
  display_name: string
  description?: string
  context_window?: number
  visibility?: string
}

interface CodexModelsResponse {
  models: CodexModelInfo[]
}

export function createOpenaiWebFetcher(cache?: ModelCache): ModelFetcher {
  return {
    async fetchModels(_accessToken?: string): Promise<Model[]> {
      if (cache) {
        const isExpired = await cache.isExpired('openai-web')
        if (!isExpired) {
          const cached = await cache.get('openai-web')
          if (cached) {
            return cached
          }
        }
      }

      try {
        const response = await fetch(CODEX_MODELS_URL, {
          headers: {
            'User-Agent': 'llmux/1.0',
          },
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          return []
        }

        const data = (await response.json()) as CodexModelsResponse

        if (!data.models || !Array.isArray(data.models)) {
          return []
        }

        const models: Model[] = data.models.map((m) => ({
          id: m.slug,
          provider: 'openai-web' as ModelProvider,
          name: m.display_name,
          object: 'model' as const,
          context_length: m.context_window ?? 272000,
          max_completion_tokens: 128000,
          owned_by: 'openai',
        }))

        if (cache) {
          await cache.set('openai-web', models)
        }

        return models
      } catch {
        return []
      }
    },
  }
}
