import { getProvider, getRegisteredProviders, isValidProviderName } from '@llmux/core'

export type RequestFormat = 'openai' | 'anthropic' | 'gemini' | 'antigravity'

export function detectFormat(body: unknown): RequestFormat {
  if (!body || typeof body !== 'object') {
    throw new Error('Unknown request format')
  }

  const providers = getRegisteredProviders()
  // Explicitly type priority as ProviderName[] (or compatible) if possible,
  // but since we are iterating strings, we can just use `as ProviderName` when checking/getting.
  const priority = ['antigravity', 'gemini', 'anthropic', 'openai'] as const

  // Check priority providers first
  for (const name of priority) {
    // Check if the priority provider is actually registered
    // Using explicit check instead of casting
    if (isValidProviderName(name) && providers.includes(name)) {
      try {
        const provider = getProvider(name)
        if (provider.isSupportedRequest(body)) {
          return name
        }
      } catch {
        // Ignore
      }
    }
  }

  // Check remaining providers
  for (const name of providers) {
    // Skip if already checked in priority list
    if ((priority as readonly string[]).includes(name)) continue
    try {
      const provider = getProvider(name)
      if (provider.isSupportedRequest(body)) {
        // Map provider names to RequestFormat types
        if (name === 'openai-web') return 'openai'
        if (name === 'opencode-zen') continue // Skip hybrid/delegating providers
        if (['openai', 'anthropic', 'gemini', 'antigravity'].includes(name)) {
          return name as RequestFormat
        }
      }
    } catch {
      // Ignore errors accessing providers
    }
  }

  throw new Error('Unknown request format')
}
