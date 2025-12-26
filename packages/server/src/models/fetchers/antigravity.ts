import type { Model, ModelFetcher } from '../types'

// Based on CLIProxyAPI internal/registry/model_definitions.go
// GetAntigravityModelConfig()
export const ANTIGRAVITY_MODELS: Model[] = [
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
    id: 'gemini-2.5-computer-use-preview-10-2025',
    provider: 'antigravity',
    name: 'Gemini 2.5 Computer Use Preview',
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
    id: 'gemini-3-pro-image-preview',
    provider: 'antigravity',
    name: 'Gemini 3 Pro Image Preview',
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
  {
    id: 'gemini-claude-sonnet-4-5-thinking',
    provider: 'antigravity',
    name: 'Gemini Claude Sonnet 4.5 Thinking',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'gemini-claude-opus-4-5-thinking',
    provider: 'antigravity',
    name: 'Gemini Claude Opus 4.5 Thinking',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
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
