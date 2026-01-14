import { type AntigravityProvider, createLogger, getProvider, type ProviderName } from '@llmux/core'
import { AntigravityMetadataStrategy } from './antigravity/metadata'
import { AntigravityRateLimitStrategy } from './antigravity/rate-limit'
import { AntigravityThinkingStrategy } from './antigravity/thinking'
import { AntigravityUpstreamStrategy } from './antigravity/upstream'

const logger = createLogger({ service: 'strategy-registry' })

export function registerServerStrategies() {
  const providersToRegister = ['antigravity', 'gemini-cli']

  for (const providerId of providersToRegister) {
    try {
      const provider = getProvider(providerId as ProviderName) as AntigravityProvider

      // Common strategies for all Antigravity-based providers
      provider.registerStrategy(new AntigravityThinkingStrategy())
      provider.registerStrategy(new AntigravityMetadataStrategy())
      provider.registerStrategy(new AntigravityRateLimitStrategy())

      // Upstream strategy is currently specific to the 'antigravity' provider.
      // 'gemini-cli' uses specialized logic in upstream-request-builder.ts for now.
      if (providerId === 'antigravity') {
        provider.registerStrategy(new AntigravityUpstreamStrategy())
      }

      logger.debug({ provider: providerId }, 'Registered server strategies for provider')
    } catch (err) {
      // Provider might not be registered yet or not found
      logger.warn({ provider: providerId, err }, 'Failed to register strategies for provider')
    }
  }
}
