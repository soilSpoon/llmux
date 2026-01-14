/**
 * Antigravity Error Handling Strategy
 *
 * Handles upstream errors for Antigravity provider.
 * Features:
 * - License error fallback (permission denied -> default project)
 * - 403 fallback (forbidden -> default project)
 * - Endpoint rotation on 5xx and 429
 * - Network error retry logic
 */

import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from '@llmux/auth'
import { createLogger } from '@llmux/core'
import type {
  ErrorHandlingAction,
  ErrorHandlingOptions,
  ErrorHandlingStrategy,
} from '@llmux/core/types/provider-strategies'
import type { RetryState } from '../../handlers/types'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  isLicenseError,
  shouldFallbackToDefaultProject,
} from '../../providers/antigravity'

const logger = createLogger({ service: 'antigravity-error-strategy' })

// Extend the options type locally to include what we need
export interface AntigravityErrorOptions extends ErrorHandlingOptions {
  retryState: RetryState
  reqId?: string
}

export class AntigravityErrorStrategy implements ErrorHandlingStrategy {
  readonly strategyType = 'errorHandling' as const

  async handleError(options: ErrorHandlingOptions): Promise<ErrorHandlingAction | null> {
    const { status, errorText, currentProjectId } = options
    const { reqId, retryState } = options as AntigravityErrorOptions

    if (!retryState) {
      logger.warn({ reqId }, 'RetryState missing in error strategy')
      return null
    }

    const licenseCtx = {
      errorBody: errorText,
      status,
      currentProject: currentProjectId,
    }

    // 1. License Error / 403 Fallback
    if (isLicenseError(licenseCtx)) {
      if (shouldFallbackToDefaultProject(licenseCtx) && !retryState.overrideProjectId) {
        retryState.overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
        logger.warn(
          { reqId, status, currentProject: currentProjectId },
          'Falling back to default project due to license/permission error'
        )
        return { action: 'retry' }
      }

      // Rotate endpoint if project fallback didn't happen or already tried
      return this.rotateEndpoint(retryState, reqId, 'License error')
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

    // 2. Server Errors (5xx)
    if (status >= 500) {
      return this.rotateEndpoint(retryState, reqId, 'Antigravity server error')
    }

    // 3. Rate Limits (429)
    if (status === 429) {
      return this.rotateEndpoint(retryState, reqId, 'Antigravity 429')
    }

    return null
  }

  private rotateEndpoint(
    retryState: RetryState,
    reqId: string | undefined,
    reason: string
  ): ErrorHandlingAction | null {
    retryState.antigravityEndpointIndex++
    if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
      logger.warn(
        { reqId, newEndpointIndex: retryState.antigravityEndpointIndex, reason },
        `${reason}, rotating endpoint`
      )
      return { action: 'retry' }
    }
    return null
  }
}
