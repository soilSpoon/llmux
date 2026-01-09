import { getRegisteredProviders, isValidProviderName } from '@llmux/core'
import { KNOWN_PROVIDERS } from './constants'
import type { UpstreamProvider } from './types'

/**
 * Parses explicit provider from model name.
 * Supports two formats:
 * 1. "provider/model" (preferred) - e.g., "antigravity/claude-3-opus"
 * 2. "model:provider" (legacy) - e.g., "claude-3-opus:antigravity"
 *
 * Examples:
 * - "antigravity/claude-3-opus" -> { model: "claude-3-opus", provider: "antigravity" }
 * - "claude-3-opus:antigravity" -> { model: "claude-3-opus", provider: "antigravity" } (legacy)
 * - "claude-3-opus" -> { model: "claude-3-opus", provider: undefined }
 */
export function parseExplicitProvider(model: string): {
  model: string
  provider?: UpstreamProvider
} {
  // Check for provider/model format (e.g. "antigravity/claude-3-opus")
  if (model.includes('/')) {
    const parts = model.split('/')
    // Provider is the first segment
    const providerCandidate = parts[0]

    if (
      providerCandidate &&
      ((isValidProviderName(providerCandidate) &&
        getRegisteredProviders().includes(providerCandidate)) ||
        (KNOWN_PROVIDERS as readonly string[]).includes(providerCandidate))
    ) {
      const baseModel = model.slice(providerCandidate.length + 1)
      // Ensure baseModel is not empty
      if (baseModel) {
        return {
          model: baseModel,
          provider: providerCandidate as UpstreamProvider,
        }
      }
    }
  }

  if (!model.includes(':')) {
    return { model }
  }

  const parts = model.split(':')
  const providerCandidate = parts[parts.length - 1] ?? ''
  const baseModel = parts.slice(0, -1).join(':')

  const knownProviders = [
    'openai',
    'anthropic',
    'gemini',
    'antigravity',
    'opencode-zen',
    'openai-web',
    'github-copilot',
  ]

  if (
    (isValidProviderName(providerCandidate) &&
      getRegisteredProviders().includes(providerCandidate)) ||
    knownProviders.includes(providerCandidate)
  ) {
    return {
      model: baseModel,
      provider: providerCandidate as UpstreamProvider,
    }
  }

  if (providerCandidate === 'github-copilot') {
    return {
      model: baseModel,
      provider: 'github-copilot',
    }
  }

  return { model }
}

/**
 * Check if a provider is an OpenAI-compatible provider
 */
export function isOpenAICompatibleProvider(provider: string): boolean {
  return provider === 'openai' || provider === 'openai-web'
}
