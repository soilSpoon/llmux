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
import { createLogger } from '@llmux/core'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  isLicenseError,
  prepareAntigravityRequest,
  shouldFallbackToDefaultProject,
} from '../../providers/antigravity'
import type {
  ErrorContext,
  ErrorHandlingResult,
  PrepareContextOptions,
  ProviderRequestContext,
  ProviderRequestStrategy,
  RetryState,
} from './provider-strategy'
import { registerProviderStrategy } from './provider-strategy'

const logger = createLogger({ service: 'antigravity-strategy' })

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
}

const antigravityStrategy = new AntigravityStrategy()
registerProviderStrategy(antigravityStrategy)

export { antigravityStrategy }
