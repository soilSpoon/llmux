import type { ProviderName } from '@llmux/core'

/**
 * Model lookup interface for resolving models to providers
 */
export interface ModelLookup {
  /**
   * Get provider for a given model ID.
   * Returns the provider name if found, undefined otherwise.
   */
  getProviderForModel(modelId: string): Promise<string | undefined>

  /**
   * Force refresh the model cache.
   */
  refresh(): Promise<void>
}

/**
 * Extended provider names including virtual/upstream providers
 */
export type UpstreamProvider = ProviderName | 'openai-web' | 'opencode-zen'

export interface ModelResolution {
  /** Primary provider to use */
  providerId: UpstreamProvider
  /** Model name to send to provider (may be transformed) */
  targetModel: string
  /** Fallback routes in priority order */
  fallbacks: Array<{ provider: UpstreamProvider; model: string }>
  /** Source of the resolution decision */
  source: 'explicit' | 'mapping' | 'lookup' | 'inference' | 'default'
}

export interface ModelRouterConfig {
  /** ModelLookup instance (from /models infrastructure) */
  modelLookup?: ModelLookup
  /** Static model → provider mappings (from config file) */
  modelMappings?: Record<
    string,
    {
      provider: UpstreamProvider
      model: string
      fallbacks?: string[]
    }
  >
  /** Default provider when no rule matches */
  defaultProvider?: UpstreamProvider
  /** Enable OpenAI credential-based fallback */
  enableOpenAIFallback?: boolean
}

export interface CredentialChecker {
  hasCredential(provider: UpstreamProvider): Promise<boolean>
}
