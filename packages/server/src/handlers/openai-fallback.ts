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
import { isOpenAICompatibleProvider, isOpenAIModel } from '../routing/model-rules'
import { isRateLimited } from '../upstream'

export { isRateLimited, isOpenAICompatibleProvider, isOpenAIModel }

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
 * @deprecated Use ModelRouter logic instead
 * Resolve which OpenAI provider to use based on availability
 */
export async function resolveOpenAIProvider(): Promise<ResolvedProvider> {
  const availability = await checkOpenAIProviderAvailability()

  logger.debug({ availability }, 'OpenAI provider availability check')

  // Neither available - default to openai (will fail at credential lookup)
  if (!availability.openai && !availability['openai-web']) {
    return { primary: 'openai', fallback: null }
  }

  // Only openai available
  if (availability.openai && !availability['openai-web']) {
    return { primary: 'openai', fallback: null }
  }

  // Only openai-web available
  if (!availability.openai && availability['openai-web']) {
    return { primary: 'openai-web', fallback: null }
  }

  // Both available - prefer openai-web with openai as fallback
  return { primary: 'openai-web', fallback: 'openai' }
}
