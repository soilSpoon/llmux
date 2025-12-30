/**
 * OpenAI Provider Fallback Logic
 *
 * Handles provider selection between openai and openai-web:
 * 1. If only one is logged in → use that
 * 2. If both are logged in → prefer openai-web
 * 3. If openai-web returns 429 → fallback to openai
 */

import { CredentialStorage } from '@llmux/auth'
import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'openai-fallback' })

export type OpenAIProviderType = 'openai' | 'openai-web'

export interface ProviderAvailability {
  openai: boolean
  'openai-web': boolean
}

export interface ResolvedProvider {
  primary: OpenAIProviderType
  fallback: OpenAIProviderType | null
}

/**
 * Check which OpenAI-compatible providers have credentials
 */
export async function checkOpenAIProviderAvailability(): Promise<ProviderAvailability> {
  const [openaiCreds, openaiWebCreds] = await Promise.all([
    CredentialStorage.get('openai'),
    CredentialStorage.get('openai-web'),
  ])

  return {
    openai: openaiCreds.length > 0,
    'openai-web': openaiWebCreds.length > 0,
  }
}

/**
 * Resolve which OpenAI provider to use based on availability
 *
 * Priority:
 * 1. If only one is available → use that one, no fallback
 * 2. If both are available → use openai-web as primary, openai as fallback
 * 3. If neither is available → return openai as primary (will fail at auth)
 */
export async function resolveOpenAIProvider(): Promise<ResolvedProvider> {
  const availability = await checkOpenAIProviderAvailability()

  logger.debug({ availability }, 'OpenAI provider availability check')

  // Neither available - default to openai (will fail at credential lookup)
  if (!availability.openai && !availability['openai-web']) {
    logger.warn('No OpenAI credentials found')
    return { primary: 'openai', fallback: null }
  }

  // Only openai available
  if (availability.openai && !availability['openai-web']) {
    logger.debug('Using openai (only available provider)')
    return { primary: 'openai', fallback: null }
  }

  // Only openai-web available
  if (!availability.openai && availability['openai-web']) {
    logger.debug('Using openai-web (only available provider)')
    return { primary: 'openai-web', fallback: null }
  }

  // Both available - prefer openai-web with openai as fallback
  logger.debug('Both providers available - using openai-web with openai fallback')
  return { primary: 'openai-web', fallback: 'openai' }
}

/**
 * Check if a response indicates rate limiting (429)
 */
export function isRateLimited(response: Response): boolean {
  return response.status === 429
}

/**
 * Check if a provider is an OpenAI-compatible provider
 */
export function isOpenAICompatibleProvider(provider: string): provider is OpenAIProviderType {
  return provider === 'openai' || provider === 'openai-web'
}

/**
 * Check if a model is typically served by OpenAI
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
