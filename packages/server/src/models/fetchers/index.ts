import type { ModelCache } from '../cache'
import type { ModelFetcher, ModelProvider } from '../types'

import { ANTIGRAVITY_MODELS, createAntigravityFetcher } from './antigravity'
import { createGithubCopilotFetcher, GITHUB_COPILOT_API_URL } from './github-copilot'
import { createModelsDevFetcher, MODELS_DEV_API_URL } from './models-dev'

export interface FetcherFactoryOptions {
  cache?: ModelCache
}

export type FetcherStrategy = 'hardcoded' | 'api' | 'models-dev'

// Maps internal provider names to models.dev provider IDs
const MODELS_DEV_PROVIDER_MAP: Partial<Record<ModelProvider, string>> = {
  'opencode-zen': 'opencode',
}

export function getFetcherStrategy(provider: ModelProvider): FetcherStrategy {
  switch (provider) {
    case 'antigravity':
      return 'hardcoded'
    case 'github-copilot':
      return 'api'
    default:
      return 'models-dev'
  }
}

export function createFetcher(
  provider: ModelProvider,
  options: FetcherFactoryOptions = {}
): ModelFetcher {
  const strategy = getFetcherStrategy(provider)

  switch (strategy) {
    case 'hardcoded':
      return createAntigravityFetcher()
    case 'api':
      return createGithubCopilotFetcher()
    case 'models-dev': {
      // Map internal provider to models.dev provider ID
      const modelsDevProvider = MODELS_DEV_PROVIDER_MAP[provider] ?? provider
      return createModelsDevFetcher(modelsDevProvider as ModelProvider, options.cache, provider)
    }
  }
}

export {
  createAntigravityFetcher,
  ANTIGRAVITY_MODELS,
  createGithubCopilotFetcher,
  GITHUB_COPILOT_API_URL,
  createModelsDevFetcher,
  MODELS_DEV_API_URL,
}
