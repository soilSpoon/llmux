import {
  type AntigravityProvider,
  type BaseProvider,
  createLogger,
  getProvider,
  type ProviderName,
} from '@llmux/core'
import { AntigravityErrorStrategy } from './antigravity/error'
import { AntigravityMetadataStrategy } from './antigravity/metadata'
import { AntigravityRateLimitStrategy } from './antigravity/rate-limit'
import { AntigravityThinkingStrategy } from './antigravity/thinking'
import { AntigravityUpstreamStrategy } from './antigravity/upstream'
import { OpencodeZenErrorStrategy } from './opencode-zen/error'

const logger = createLogger({ service: 'strategy-registry' })

export function registerServerStrategies() {
  const providersToRegister = ['antigravity', 'gemini-cli', 'opencode-zen']

  for (const providerId of providersToRegister) {
    try {
      const provider = getProvider(providerId as ProviderName)

      if (typeof (provider as BaseProvider).registerStrategy !== 'function') {
        logger.warn(
          { provider: providerId },
          'Provider does not support strategies, cannot register'
        )
        continue
      }

      const baseProvider = provider as BaseProvider

      if (providerId === 'antigravity' || providerId === 'gemini-cli') {
        const agProvider = baseProvider as unknown as AntigravityProvider
        // Common strategies for all Antigravity-based providers
        agProvider.registerStrategy(new AntigravityThinkingStrategy())
        agProvider.registerStrategy(new AntigravityMetadataStrategy())
        agProvider.registerStrategy(new AntigravityRateLimitStrategy())
        agProvider.registerStrategy(new AntigravityErrorStrategy())

        // Upstream strategy is currently specific to the 'antigravity' provider.
        // 'gemini-cli' uses specialized logic in upstream-request-builder.ts for now.
        if (providerId === 'antigravity') {
          agProvider.registerStrategy(new AntigravityUpstreamStrategy())
        }
      }

      if (providerId === 'opencode-zen') {
        baseProvider.registerStrategy(new OpencodeZenErrorStrategy())
      }

      logger.debug({ provider: providerId }, 'Registered server strategies for provider')
    } catch (err) {
      // Provider might not be registered yet or not found
      logger.warn({ provider: providerId, err }, 'Failed to register strategies for provider')
    }
  }
}
