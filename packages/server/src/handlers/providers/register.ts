import { createLogger } from '@llmux/core'
import { antigravityStrategy } from './antigravity-strategy'
import { geminiCliStrategy } from './gemini-cli-strategy'
import { registerProviderStrategy } from './provider-strategy'

const logger = createLogger({ service: 'legacy-strategy-registry' })

/**
 * Registers "System A" (Legacy/Server-side) strategies.
 * These are used by request-handler.ts for retry logic and error handling.
 *
 * TODO: Migrate these to "System B" (Core ProviderStrategy) and deprecate this.
 */
export function registerLegacyProviderStrategies(): void {
  registerProviderStrategy(antigravityStrategy)
  registerProviderStrategy(geminiCliStrategy)
  logger.debug('Registered legacy provider strategies')
}
