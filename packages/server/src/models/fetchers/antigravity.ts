import type { Model, ModelFetcher } from '../types'

export const ANTIGRAVITY_MODELS: Model[] = [
  // Claude models
  {
    id: 'claude-sonnet-4-5',
    provider: 'antigravity',
    name: 'Claude Sonnet 4.5',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-sonnet-4',
    provider: 'antigravity',
    name: 'Claude Sonnet 4',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-opus-4-5',
    provider: 'antigravity',
    name: 'Claude Opus 4.5',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-opus-4-1',
    provider: 'antigravity',
    name: 'Claude Opus 4.1',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 32000,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'antigravity',
    name: 'Claude Haiku 4.5',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-5-haiku',
    provider: 'antigravity',
    name: 'Claude 3.5 Haiku',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 8192,
    owned_by: 'anthropic',
  },
  // Gemini models
  {
    id: 'gemini-2.5-flash',
    provider: 'antigravity',
    name: 'Gemini 2.5 Flash',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'antigravity',
    name: 'Gemini 2.5 Flash Lite',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'antigravity',
    name: 'Gemini 3 Pro Preview',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'antigravity',
    name: 'Gemini 3 Flash Preview',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
]

export function createAntigravityFetcher(): ModelFetcher {
  return {
    async fetchModels(_accessToken?: string): Promise<Model[]> {
      return ANTIGRAVITY_MODELS
    },
  }
}
