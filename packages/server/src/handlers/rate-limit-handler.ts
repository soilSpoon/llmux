import { ANTIGRAVITY_ENDPOINT_FALLBACKS, type Credential, TokenRefresh } from '@llmux/auth'
import {
  createLogger,
  type ErrorHandlingStrategy,
  getProvider,
  type ProviderName,
} from '@llmux/core'
import { accountRotationManager } from './account-rotation'
import { getModelFamily } from './family-rate-limiting'
import type { ErrorHandlingContext, ErrorHandlingResult, RetryState } from './types'

const logger = createLogger({ service: 'rate-limit-handler' })

export const MAX_RETRY_ATTEMPTS = 40

export function createRetryState(maxRetryAttempts: number = MAX_RETRY_ATTEMPTS): RetryState {
  return {
    attempt: 0,
    accountIndex: -1,
    antigravityEndpointIndex: 0,
    overrideProjectId: null,
    maxRetryAttempts,
  }
}

export function shouldContinueRetry(state: RetryState): boolean {
  return state.attempt < state.maxRetryAttempts
}

export function incrementAttempt(state: RetryState): void {
  state.attempt++
}

function computeRateLimitDelayMs(
  retryState: RetryState,
  retryAfterMs?: number
): number | undefined {
  // Keep tests fast and deterministic
  if (process.env.NODE_ENV === 'test') {
    return 1
  }

  const MAX_DELAY_MS = 300_000 // cap at 5 minutes

  // If upstream gave us a Retry-After, respect it (with a cap)
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_DELAY_MS)
  }

  const BASE_DELAY_MS = 5000
  const attemptIndex = Math.max(0, (retryState.attempt ?? 1) - 1)

  // Exponential backoff: 5s, 10s, 20s, 40s, ... up to MAX_DELAY_MS
  const delay = BASE_DELAY_MS * 2 ** attemptIndex
  return Math.min(delay, MAX_DELAY_MS)
}

/**
 * Handles upstream errors and determines the next action (retry logic).
 *
 * Return actions meaning:
 * - 'retry': Wait for `delay` (if provided) and continue the retry loop.
 * - 'switch-model': Switch to `newModel` (and optionally `newProvider`), reset retry state, and continue loop.
 * - 'all-cooldown': All providers/models/accounts are rate-limited, return 429 to client.
 * - 'throw': Stop retrying.
 *    - In Streaming Handler: Throws an Error, which results in a 500 JSON response to the client.
 *    - In Proxy Handler: Breaks the loop and returns the original upstream response (passing through status code and body).
 */
export async function handleUpstreamError(
  context: ErrorHandlingContext
): Promise<ErrorHandlingResult> {
  const {
    reqId,
    provider,
    model,
    status,
    errorText,
    retryState,
    currentProjectId,
    router,
    apiKey,
  } = context

  // 1. Provider-Specific Strategy Handling (System B)
  try {
    const providerInstance = getProvider(provider)
    const strategy = providerInstance.getStrategy<ErrorHandlingStrategy>('errorHandling')

    if (strategy) {
      // Pass retryState as part of the options (extended context)
      // This matches the implementation in AntigravityErrorStrategy
      const strategyResult = await strategy.handleError({
        provider,
        model,
        originalModel: context.originalModel,
        status,
        errorText,
        retryAfterMs: context.retryAfterMs,
        currentProjectId,
        // @ts-expect-error - strategies may expect extended context
        router,
        retryState,
        reqId,
      })

      if (strategyResult) {
        return strategyResult
      }
    }
  } catch {
    // Provider might not support error strategy, or getProvider failed
    // Fall back to generic handling
  }

  // Rate limit handling (Generic logic that applies after or instead of strategy)
  if (status === 429) {
    const family = context.family || getModelFamily(model, provider)

    // 1. Determine the effective duration for this rate limit
    // Use explicit time from upstream if available, otherwise use exponential backoff
    const backoffDelay = computeRateLimitDelayMs(retryState, undefined) || 5000
    const effectiveRetryAfter =
      context.retryAfterMs !== undefined ? context.retryAfterMs : backoffDelay

    // Construct detailed log data
    const logData: Record<string, unknown> = {
      reqId,
      status,
      retryAfter: effectiveRetryAfter,
      originalRetryAfter: context.retryAfterMs,
      family,
      provider,
      model,
      accountIndex: retryState.accountIndex,
    }

    // Add Antigravity specific details
    if (provider === 'antigravity') {
      logData.endpointIndex = retryState.antigravityEndpointIndex
      if (
        ANTIGRAVITY_ENDPOINT_FALLBACKS &&
        retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length
      ) {
        logData.endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex]
      }
    }

    logger.warn(logData, 'Rate limited')

    // Mark current as rate limited with explicit Hard/Soft type
    if (apiKey) {
      if (router) {
        // Notify router of rate limit to avoid immediate retry of the same model
        router.handleRateLimit(model, effectiveRetryAfter)

        const targetModel =
          context.originalModel && context.originalModel !== 'unknown'
            ? context.originalModel
            : context.model

        try {
          const routeResult = await router.resolveModel(targetModel)
          if (routeResult.provider !== provider || routeResult.model !== model) {
            return {
              action: 'switch-model',
              newModel: routeResult.model,
              newProvider: routeResult.provider as ProviderName,
            }
          }
        } catch (err) {
          logger.warn({ reqId, targetModel, err }, 'Failed to resolve fallback with API key')
        }
      }
      return { action: 'retry', delay: computeRateLimitDelayMs(retryState, effectiveRetryAfter) }
    }

    // Mark current as rate limited with explicit Hard/Soft type
    // Check if all accounts are limited
    let areAllLimited = false
    let credentials: Credential[] = []
    try {
      // Mark current as rate limited with explicit Hard/Soft type
      // Wrap in try-catch because this may call TokenRefresh which can fail in tests
      await accountRotationManager
        .markRateLimited(
          provider,
          model,
          retryState.accountIndex,
          effectiveRetryAfter,
          effectiveRetryAfter > 24 * 3600 * 1000
            ? 'Long-term Limit'
            : effectiveRetryAfter > 3600_000
              ? 'Hard Limit'
              : 'Transient 429'
        )
        .catch((err) =>
          logger.debug({ err, provider, model }, 'Failed to mark rate limit (non-critical)')
        )

      // Reset endpoint index when rotating account or preparing for fallback
      // System B: Check if provider has a hook for account rotation
      // NOTE: onAccountRotation is currently part of the legacy strategy interface.
      // In System B, we should probably handle this in the upstream strategy or error strategy?
      // Or just hardcode for antigravity here if needed, or make it generic.
      //
      // For now, AntigravityUpstreamStrategy handles preparing context which sets endpoint index.
      // But we need to RESET it when we switch accounts.
      if (provider === 'antigravity') {
        retryState.antigravityEndpointIndex = 0
      }

      credentials = (await TokenRefresh.ensureFresh(provider)) || []
      if (
        credentials.length === 0 ||
        accountRotationManager.areAllRateLimited(provider, model, credentials)
      ) {
        areAllLimited = true
      }
    } catch (err) {
      logger.debug({ err, provider, model }, 'Failed to check credentials for rate limit')
      areAllLimited = true
    }

    if (areAllLimited) {
      // Router handling: Only mark the model as globally limited if ALL accounts are limited
      if (router && model) {
        router.handleRateLimit(model, effectiveRetryAfter)
      }

      // 2. Try Router Smart Fallback
      if (router) {
        const targetModel =
          context.originalModel && context.originalModel !== 'unknown'
            ? context.originalModel
            : context.model

        try {
          const routeResult = await router.resolveModel(targetModel)

          // If router found a different provider or model that is NOT the current one
          // (resolveModel checks cooldowns, so it should return a non-cooled-down option if available)
          if (routeResult.provider !== provider || routeResult.model !== model) {
            logger.warn(
              {
                reqId,
                current: { provider, model },
                fallback: { provider: routeResult.provider, model: routeResult.model },
              },
              'All accounts rate limited or provider error, router suggested fallback'
            )
            return {
              action: 'switch-model',
              newModel: routeResult.model,
              newProvider: routeResult.provider as ProviderName,
            }
          }
        } catch (err) {
          logger.warn(
            { reqId, targetModel, err },
            'Failed to resolve fallback model during rate limit handling'
          )
        }
      }

      // If all limited and no fallback found, return 429 to client
      return { action: 'all-cooldown', reason: context.errorText }
    }

    // Only attempt account rotation if we know which account failed (index != -1)
    if (
      retryState.accountIndex !== -1 &&
      accountRotationManager.hasNext(provider, model, retryState.accountIndex, credentials)
    ) {
      // Just retry - the builder will call getCredential(..., currentIndex)
      // which will naturally move to the next available account.
      return { action: 'retry' }
    }

    // Fallback behavior: just retry with delay if nothing else works
    return { action: 'retry', delay: computeRateLimitDelayMs(retryState, effectiveRetryAfter) }
  }

  return { action: 'throw' }
}
