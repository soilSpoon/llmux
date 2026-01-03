import { getProvider, getRegisteredProviders, isValidProviderName } from '@llmux/core'
import type { UpstreamProvider } from './types'

/**
 * Parses explicit provider suffix from model name
 * e.g. "claude-3-opus:antigravity" -> { model: "claude-3-opus", provider: "antigravity" }
 */
export function parseExplicitProvider(model: string): {
  model: string
  provider?: UpstreamProvider
} {
  if (!model.includes(':')) {
    return { model }
  }

  const parts = model.split(':')
  const providerCandidate = parts[parts.length - 1] ?? ''
  const baseModel = parts.slice(0, -1).join(':')

  // Validate against registered providers OR known providers that might not be registered in core
  // but are valid in our routing context (e.g. opencode-zen, openai-web)
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

  // Special handling for github-copilot (auth provider but valid target)
  if (providerCandidate === 'github-copilot') {
    return {
      model: baseModel,
      provider: 'github-copilot',
    }
  }

  return { model }
}

/**
 * Infers provider from model name prefixes/patterns
 * Used as a fallback when ModelLookup fails or is not available
 */
export function inferProviderFromModel(model: string): UpstreamProvider {
  // Specific pattern matching overrides
  if (model.includes('gemini-claude')) return 'antigravity'
  if (model.startsWith('gemini-3-')) return 'antigravity'
  if (model.endsWith('-antigravity')) return 'antigravity'

  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gemini-')) return 'gemini'

  // Priority order for inference (OAuth providers first, then API key providers)
  const priorityOrder: UpstreamProvider[] = [
    // OAuth providers (free/quota-based)
    'antigravity',
    'openai-web',
    'github-copilot',
    // API key providers
    'opencode-zen',
    'anthropic',
    'gemini',
    'openai',
  ]

  // Check priority providers first
  for (const name of priorityOrder) {
    try {
      const provider = getProvider(name)
      if (provider.isSupportedModel(model)) {
        return name
      }
    } catch {
      // Provider might not be registered
    }
  }

  // Check any remaining registered providers
  const registered = getRegisteredProviders()
  for (const name of registered) {
    if (priorityOrder.includes(name as UpstreamProvider)) continue

    try {
      const provider = getProvider(name)
      if (provider.isSupportedModel(model)) {
        return name as UpstreamProvider
      }
    } catch {
      // Ignore
    }
  }

  // Default fallback
  return 'openai'
}

/**
 * Checks if a model is an OpenAI or OpenAI-compatible model
 * Used for fallback logic
 */
export function isOpenAIModel(model: string): boolean {
  return (
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.includes('codex')
  )
}

export function getHardcodedModelFallback(
  model: string
): { model: string; provider?: UpstreamProvider } | null {
  if (model === 'gemini-claude-opus-4-5-thinking') {
    return { model: 'gemini-3-pro-high', provider: 'antigravity' }
  }
  return null
}

/**
 * Check if a provider is an OpenAI-compatible provider
 */
export function isOpenAICompatibleProvider(provider: string): boolean {
  return provider === 'openai' || provider === 'openai-web'
}
