export type ModelProvider =
  | 'antigravity'
  | 'github-copilot'
  | 'opencode-zen'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'google'
  | 'openrouter'
  | (string & {})

export interface Model {
  id: string
  provider: ModelProvider
  name: string
  object: 'model'
  context_length?: number
  max_completion_tokens?: number
  created?: number
  owned_by?: string
}

export interface ModelsResponse {
  object: 'list'
  data: Model[]
  providers: ModelProvider[]
  mappings?: Array<{ from: string; to: string | string[] }>
}

export interface ModelFetcher {
  fetchModels(accessToken?: string): Promise<Model[]>
}
