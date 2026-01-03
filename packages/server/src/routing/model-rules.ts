import { getRegisteredProviders, isValidProviderName } from '@llmux/core'
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
