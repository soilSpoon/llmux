/**
 * AntigravityStrategy
 *
 * Handles request preparation and error handling for Antigravity provider.
 * Features:
 * - OAuth credential rotation
 * - Endpoint fallback rotation
 * - License error fallback to default project
 * - Project ID management
 */

import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
} from '@llmux/auth'
import { createLogger, createTextHash, getModelFamily, type SignatureCache } from '@llmux/core'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  isLicenseError,
  prepareAntigravityRequest,
  shouldFallbackToDefaultProject,
} from '../../providers/antigravity'
// Remove unused type imports to fix lint error
// import type { SignatureStore } from '../../stores'
import { extractSignaturesFromSSE } from '../signature-response'
import { recordSignaturesFromSSE } from '../stream-helpers'
import type { SignatureContext } from '../stream-helpers/stream-signature-recorder'
import type {
  ErrorContext,
  ErrorHandlingResult,
  PrepareContextOptions,
  ProviderRequestContext,
  ProviderRequestStrategy,
  RetryState,
  StreamCompleteContext,
  StreamEventContext,
} from './provider-strategy'

const logger = createLogger({ service: 'antigravity-strategy' })

// Define Antigravity-specific context structure
interface AntigravityStreamContext {
  signatureContext?: SignatureContext & {
    signatureCache?: SignatureCache
    sessionId: string
    // Allow other fields
    [key: string]: unknown
  }
  // Allow other fields
  [key: string]: unknown
}

export class AntigravityStrategy implements ProviderRequestStrategy {
  readonly provider = 'antigravity' as const

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
      logger.warn({ reqId }, 'No credentials available for Antigravity')
      return null
    }

    retryState.accountIndex = antigravityContext.accountIndex

    const baseUrl =
      ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
      ANTIGRAVITY_ENDPOINT_FALLBACKS[0]

    const endpoint = streaming
      ? `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
      : `${baseUrl}${ANTIGRAVITY_API_PATH_GENERATE}`

    return {
      provider: 'antigravity',
      headers: antigravityContext.headers,
      endpoint,
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
    const { reqId, status, errorText, currentProjectId } = ctx

    const licenseCtx = {
      errorBody: errorText,
      status,
      currentProject: currentProjectId,
    }

    if (isLicenseError(licenseCtx)) {
      if (shouldFallbackToDefaultProject(licenseCtx) && !retryState.overrideProjectId) {
        retryState.overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
        logger.warn(
          { reqId, status, currentProject: currentProjectId },
          'Falling back to default project due to license/permission error'
        )
        return { action: 'retry' }
      }

      retryState.antigravityEndpointIndex++
      if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
        return { action: 'retry' }
      }
    } else if (
      status === 403 &&
      currentProjectId !== ANTIGRAVITY_DEFAULT_PROJECT_ID &&
      !retryState.overrideProjectId
    ) {
      retryState.overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
      logger.warn(
        { reqId, currentProjectId },
        'Unexpected 403, trying default project before rotation'
      )
      return { action: 'retry' }
    }

    if (status >= 500) {
      retryState.antigravityEndpointIndex++
      if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
        logger.warn(
          { reqId, status, newEndpointIndex: retryState.antigravityEndpointIndex },
          'Antigravity server error, rotating endpoint'
        )
        return { action: 'retry' }
      }
    }

    if (status === 429) {
      retryState.antigravityEndpointIndex++
      if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
        logger.warn(
          { reqId, newEndpointIndex: retryState.antigravityEndpointIndex },
          'Antigravity 429, rotating endpoint before rotating account'
        )
        return { action: 'retry' }
      }
    }

    return null
  }

  async handleNetworkError(
    _error: Error,
    retryState: RetryState
  ): Promise<ErrorHandlingResult | null> {
    retryState.antigravityEndpointIndex++
    if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
      const delay = process.env.NODE_ENV === 'test' ? 1 : 200
      return { action: 'retry', delay }
    }
    return null
  }

  onAccountRotation(retryState: RetryState): void {
    retryState.antigravityEndpointIndex = 0
  }

  handleStreamEvent(ctx: StreamEventContext): void {
    const { event, context, state } = ctx
    const agContext = context as AntigravityStreamContext

    if (agContext.signatureContext) {
      const signatures = extractSignaturesFromSSE(`data: ${event}`)
      if (signatures.length > 0) {
        state.accumulatedSignatures.push(...signatures)
        recordSignaturesFromSSE(event, agContext.signatureContext)
      }
    }
  }

  onStreamComplete(ctx: StreamCompleteContext): void {
    const { context, state, reqId } = ctx
    const { accumulatedThinking, accumulatedSignatures, finalModel, targetModel } = state
    const agContext = context as AntigravityStreamContext

    // Store Thinking Text in Cache
    if (
      agContext.signatureContext?.signatureCache &&
      accumulatedThinking &&
      accumulatedSignatures.length > 0
    ) {
      const { signatureCache, sessionId } = agContext.signatureContext
      const thinkingText = accumulatedThinking
      const model = finalModel || targetModel || 'unknown'

      // Use the last signature found
      const signature = accumulatedSignatures[accumulatedSignatures.length - 1]
      const textHash = createTextHash(thinkingText)
      const family = getModelFamily(model)

      logger.debug(
        { reqId, model, textLength: thinkingText.length },
        'Caching complete thinking text'
      )

      if (signature && signatureCache) {
        try {
          signatureCache.store({ sessionId, model, textHash }, signature, family, thinkingText)
        } catch (err) {
          logger.warn({ error: String(err) }, 'Failed to cache thinking text')
        }
      }
    }
  }
}

const antigravityStrategy = new AntigravityStrategy()
export { antigravityStrategy }
