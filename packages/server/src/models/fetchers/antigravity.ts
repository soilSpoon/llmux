import type { Model, ModelFetcher } from '../types'

// Based on opencode-antigravity-auth documentation
export const ANTIGRAVITY_MODELS: Model[] = [
  // --- Antigravity Quota Models ---
  {
    id: 'claude-sonnet-4-5',
    provider: 'antigravity',
    name: 'Claude Sonnet 4.5',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-sonnet-4-5-thinking-low',
    provider: 'antigravity',
    name: 'Claude Sonnet 4.5 Thinking (8K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-sonnet-4-5-thinking-medium',
    provider: 'antigravity',
    name: 'Claude Sonnet 4.5 Thinking (16K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-sonnet-4-5-thinking-high',
    provider: 'antigravity',
    name: 'Claude Sonnet 4.5 Thinking (32K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-opus-4-5-thinking-low',
    provider: 'antigravity',
    name: 'Claude Opus 4.5 Thinking (8K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-opus-4-5-thinking-medium',
    provider: 'antigravity',
    name: 'Claude Opus 4.5 Thinking (16K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },
  {
    id: 'claude-opus-4-5-thinking-high',
    provider: 'antigravity',
    name: 'Claude Opus 4.5 Thinking (32K)',
    object: 'model',
    context_length: 200000,
    max_completion_tokens: 64000,
    owned_by: 'google',
  },

  // --- Gemini CLI Quota Models ---
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
    id: 'gemini-2.5-pro',
    provider: 'antigravity',
    name: 'Gemini 2.5 Pro',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-flash',
    provider: 'antigravity',
    name: 'Gemini 3 Flash',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-flash-high',
    provider: 'antigravity',
    name: 'Gemini 3 Flash High',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-flash-low',
    provider: 'antigravity',
    name: 'Gemini 3 Flash Low',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-pro-high',
    provider: 'antigravity',
    name: 'Gemini 3 Pro High',
    object: 'model',
    context_length: 1048576,
    max_completion_tokens: 65536,
    owned_by: 'google',
  },
  {
    id: 'gemini-3-pro-low',
    provider: 'antigravity',
    name: 'Gemini 3 Pro Low',
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
