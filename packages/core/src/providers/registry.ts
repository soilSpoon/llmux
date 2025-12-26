import { logger } from '../util/logger'
import type { Provider, ProviderName } from './base'

/**
 * Registry of all registered providers
 */
const providers = new Map<ProviderName, Provider>()

logger.debug({ url: import.meta.url }, 'Provider registry module loaded')

/**
 * Get a registered provider by name
 */
export function getProvider(name: ProviderName): Provider {
  const provider = providers.get(name)
  if (!provider) {
    throw new Error(`Provider "${name}" not registered`)
  }
  return provider
}

/**
 * Register a provider
 */
export function registerProvider(provider: Provider): void {
  providers.set(provider.name, provider)
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: ProviderName): boolean {
  return providers.has(name)
}

/**
 * Get all registered provider names
 */
export function getRegisteredProviders(): ProviderName[] {
  return Array.from(providers.keys())
}

/**
 * Clear all registered providers (for testing)
 */
export function clearProviders(): void {
  providers.clear()
}
