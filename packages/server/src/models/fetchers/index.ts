import type { ModelCache } from '../cache'
import type { ModelFetcher, ModelProvider } from '../types'

import { ANTIGRAVITY_MODELS, createAntigravityFetcher } from './antigravity'
import { createGithubCopilotFetcher, GITHUB_COPILOT_API_URL } from './github-copilot'
import { createModelsDevFetcher, MODELS_DEV_API_URL } from './models-dev'

export interface FetcherFactoryOptions {
  cache?: ModelCache
}

export type FetcherStrategy = 'hardcoded' | 'api' | 'models-dev'

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
    case 'models-dev':
      return createModelsDevFetcher(provider, options.cache)
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
