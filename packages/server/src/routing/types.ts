import type { ProviderName } from '@llmux/core'
import type { ModelLookup } from '../models/lookup'

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
