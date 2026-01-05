import type { Model, ModelFetcher } from '../types'

export const GEMINI_CLI_MODELS: Model[] = [
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini-cli',
    name: 'Gemini 2.5 Flash',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini-cli',
    name: 'Gemini 2.5 Pro',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'gemini-cli',
    name: 'Gemini 3 Pro Preview',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini-cli',
    name: 'Gemini 3 Flash Preview',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
]

export function createGeminiCliFetcher(): ModelFetcher {
  return {
    async fetchModels(_accessToken?: string): Promise<Model[]> {
      return GEMINI_CLI_MODELS
    },
  }
}
