/**
 * GeminiCliStrategy
 *
 * Handles request preparation for Gemini CLI provider.
 * Reuses Antigravity credentials but with Gemini-specific endpoint/headers.
 */

import { prepareGeminiCliRequest } from '@llmux/auth'
import { createLogger } from '@llmux/core'
import { prepareAntigravityRequest } from '../../providers/antigravity'
import type {
  ErrorContext,
  ErrorHandlingResult,
  PrepareContextOptions,
  ProviderRequestContext,
  ProviderRequestStrategy,
  RetryState,
} from './provider-strategy'
import { getProviderStrategy } from './provider-strategy'

const logger = createLogger({ service: 'gemini-cli-strategy' })

export class GeminiCliStrategy implements ProviderRequestStrategy {
  readonly provider = 'gemini-cli' as const

  async prepareContext(
    options: PrepareContextOptions,
    retryState: RetryState
  ): Promise<ProviderRequestContext | null> {
    const { model, accountIndex, overrideProjectId, streaming, reqId } = options

    const antigravityContext = await prepareAntigravityRequest({
      model,
      accountIndex: retryState.accountIndex || accountIndex,
      overrideProjectId: retryState.overrideProjectId || overrideProjectId,
      streaming,
      reqId,
    })

    if (!antigravityContext) {
      logger.warn({ reqId }, 'No credentials available for Gemini CLI')
      return null
    }

    retryState.accountIndex = antigravityContext.accountIndex

    const geminiCliContext = await prepareGeminiCliRequest({
      model,
      accountIndex: antigravityContext.accountIndex,
      endpointIndex: retryState.antigravityEndpointIndex,
      streaming,
    })

    if (!geminiCliContext) {
      throw new Error('Failed to prepare Gemini CLI context')
    }

    return {
      provider: 'gemini-cli',
      headers: geminiCliContext.headers,
      endpoint: geminiCliContext.endpoint,
      projectId: antigravityContext.projectId,
      account: antigravityContext.account,
      accountIndex: antigravityContext.accountIndex,
      credentials: antigravityContext.credentials,
    }
  }

  async handleError(
    ctx: ErrorContext,
    retryState: RetryState
  ): Promise<ErrorHandlingResult | null> {
    const antigravityStrategy = getProviderStrategy('antigravity')
    if (antigravityStrategy?.handleError) {
      return antigravityStrategy.handleError(ctx, retryState)
    }
    return null
  }
}

const geminiCliStrategy = new GeminiCliStrategy()
export { geminiCliStrategy }
