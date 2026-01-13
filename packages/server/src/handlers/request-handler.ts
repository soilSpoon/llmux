import { ANTIGRAVITY_ENDPOINT_FALLBACKS, type Credential, TokenRefresh } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { createLogger, isValidProviderName } from '@llmux/core'
import type { ModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import type { Router } from '../routing'
import { accountRotationManager } from './account-rotation'
import { getModelFamily, isClaudeWeeklyLimit, type ModelFamily } from './family-rate-limiting'
import { applyModelMappingV2 } from './model-mapping'
import { getProviderStrategy } from './providers/provider-strategy'

const logger = createLogger({ service: 'request-handler' })

export interface RequestContext {
  originalModel: string
  currentModel: string
  effectiveProvider: ProviderName
  isThinkingEnabled: boolean | undefined
  sourceFormat: RequestFormat
}

export interface PrepareContextOptions {
  body: { model?: string; thinking?: unknown; reasoning_effort?: unknown }
  sourceFormat: RequestFormat
  targetProvider?: string
  targetModel?: string
  originalModel?: string
  thinking?: boolean
  router?: Router
  modelMappings?: ModelMapping[]
  headerTargetProvider?: string | null
  apiKey?: string
  defaultProvider?: string
}

export async function prepareRequestContext(
  options: PrepareContextOptions
): Promise<RequestContext> {
  const {
    body,
    sourceFormat,
    targetProvider: optionsTargetProvider,
    targetModel: optionsTargetModel,
    originalModel: optionsOriginalModel,
    thinking: optionsThinking,
    router,
    modelMappings,
    headerTargetProvider,
    defaultProvider: optionsDefaultProvider,
  } = options

  const originalModel = optionsOriginalModel || body.model || 'unknown'
  let currentModel = optionsTargetModel || originalModel
  let initialTargetProvider = optionsTargetProvider

  // Header override
  if (headerTargetProvider) {
    initialTargetProvider = headerTargetProvider
  }

  // Thinking detection
  const hasThinkingInRequest = body.thinking !== undefined || body.reasoning_effort !== undefined

  let isThinkingEnabled: boolean | undefined

  if (hasThinkingInRequest) {
    const thinking = body.thinking
    const thinkingType =
      typeof thinking === 'object' && thinking !== null && 'type' in thinking
        ? (thinking as { type?: string }).type
        : undefined
    isThinkingEnabled = thinkingType === 'enabled' || body.reasoning_effort !== undefined
  }

  if (optionsThinking !== undefined) {
    isThinkingEnabled = optionsThinking
  }

  // Model Mapping
  if (originalModel !== 'unknown' && !optionsTargetModel) {
    const mappingResult = applyModelMappingV2(originalModel, modelMappings)
    // console.log('DEBUG: Mapping result', { originalModel, mappingResult })
    if (mappingResult.thinking !== undefined && optionsThinking === undefined) {
      isThinkingEnabled = mappingResult.thinking
    }
    if (mappingResult.provider && isValidProviderName(mappingResult.provider)) {
      if (!initialTargetProvider) {
        initialTargetProvider = mappingResult.provider
      }
    }
    if (mappingResult.model !== originalModel) {
      currentModel = mappingResult.model
    }
  }

  // Router Resolution
  let effectiveProvider: ProviderName | undefined

  if (initialTargetProvider && isValidProviderName(initialTargetProvider)) {
    effectiveProvider = initialTargetProvider
  }

  logger.debug(
    {
      currentModel,
      initialTargetProvider,
      effectiveProviderBeforeRouter: effectiveProvider,
      hasRouter: !!router,
    },
    '[DEBUG] Before Router Resolution'
  )

  // If targetProvider is NOT set, use router.
  if (router && currentModel) {
    // Use router to resolve model aliases and provider
    // If all are in cooldown, this will throw, which we SHOULD propagate
    const routeResult = await router.resolveModel(currentModel)
    logger.debug({ routeResult }, '[DEBUG] Router Resolved')

    // Always respect router's provider choice if it resolves successfully
    const resolvedProvider = routeResult.provider
    if (isValidProviderName(resolvedProvider)) {
      effectiveProvider = resolvedProvider
    }

    // We ALWAYS accept the router's resolved model (it handles aliases)
    currentModel = routeResult.model
  }

  // Default provider fallback (if not set by header or router)
  if (!effectiveProvider && optionsDefaultProvider && isValidProviderName(optionsDefaultProvider)) {
    effectiveProvider = optionsDefaultProvider
  }

  // Remove default provider 'openai' to align with tests and explicit behavior
  // if (!effectiveProvider) {
  //   effectiveProvider = 'openai'
  // }

  // If we still don't have a provider, use the router's decision (if available) or check mappings again
  // But we DO NOT default to 'openai' blindly here.
  // Instead, we return undefined if no provider is matched, and let the caller handle it.

  return {
    originalModel,
    currentModel,
    effectiveProvider: effectiveProvider ?? ('unknown' as ProviderName),
    isThinkingEnabled,
    sourceFormat,
  }
}

export interface ErrorHandlingContext {
  reqId?: string
  provider: ProviderName
  model: string
  originalModel?: string
  status: number
  errorText: string
  retryState: RetryState
  currentProjectId?: string
  router?: Router
  retryAfterMs?: number
  family?: ModelFamily
  apiKey?: string
}

export interface ErrorHandlingResult {
  action: 'retry' | 'throw' | 'switch-model' | 'all-cooldown'
  newModel?: string
  newProvider?: ProviderName
  delay?: number
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

  // 1. Provider-Specific Strategy Handling
  const strategy = getProviderStrategy(provider)
  if (strategy?.handleError) {
    const strategyResult = await strategy.handleError(
      {
        reqId,
        provider,
        model,
        status,
        errorText,
        currentProjectId,
        retryAfterMs: context.retryAfterMs,
      },
      retryState
    )
    if (strategyResult) {
      return strategyResult
    }
  }

  // Rate limit handling (Generic logic that applies after or instead of strategy)
  if (status === 429) {
    const retryAfter = context.retryAfterMs !== undefined ? context.retryAfterMs : 30000
    const family = context.family || getModelFamily(model, provider)
    const isClaudeWeekly =
      provider === 'antigravity' && family === 'claude' && isClaudeWeeklyLimit(model)

    // Construct detailed log data
    const logData: Record<string, unknown> = {
      reqId,
      status,
      retryAfter,
      originalRetryAfter: context.retryAfterMs,
      family,
      isClaudeWeekly,
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
        router.handleRateLimit(model, retryAfter)

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
      return { action: 'retry', delay: process.env.NODE_ENV === 'test' ? 1 : 1000 }
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
          retryAfter,
          isClaudeWeekly ? 'hard' : 'soft',
          isClaudeWeekly ? 'Claude Weekly Limit' : 'Transient 429'
        )
        .catch((err) =>
          logger.debug({ err, provider, model }, 'Failed to mark rate limit (non-critical)')
        )

      // Reset endpoint index when rotating account or preparing for fallback
      const strategy = getProviderStrategy(provider)
      if (strategy?.onAccountRotation) {
        strategy.onAccountRotation(retryState)
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
        router.handleRateLimit(model, retryAfter)
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
      return { action: 'all-cooldown' }
    }

    // Check if we should fail immediately without rotation (e.g. Claude weekly limits)
    // This check must happen AFTER markRateLimited to catch the limit we just set
    // AND AFTER Router Fallback check to allow switching to other providers/models if configured
    //
    // MODIFICATION: We removed the hard abort here to allow falling back to other accounts
    // or eventually to other providers via the Router Fallback mechanism above (once all accounts are limited).
    /*
    if (
      family &&
      family !== 'unknown' &&
      familyRateLimitManager.shouldFailWithoutRotation(retryState.accountIndex, family)
    ) {
      logger.warn(
        { ...logData, reason: 'Weekly hard limit detected' },
        'Aborting rotation due to family hard limit'
      )
      return { action: 'throw' }
    }
    */

    if (accountRotationManager.hasNext(provider, model, retryState.accountIndex, credentials)) {
      // Just retry - the builder will call getCredential(..., currentIndex)
      // which will naturally move to the next available account.
      return { action: 'retry' }
    }

    // If no next account, but not all limited (maybe just this one), we already rotated or failed?
    // If hasNext is false, it means we ran out of accounts?
    // But we checked areAllRateLimited above.

    // Fallback behavior: just retry with delay if nothing else works
    return { action: 'retry', delay: process.env.NODE_ENV === 'test' ? 1 : 1000 }
  }

  return { action: 'throw' }
}

export const MAX_RETRY_ATTEMPTS = 20

export interface RetryState {
  attempt: number
  accountIndex: number
  antigravityEndpointIndex: number
  overrideProjectId: string | null
  maxRetryAttempts: number
}

export function createRetryState(maxRetryAttempts: number = 20): RetryState {
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

export function removeThinkingFromBody(body: unknown): void {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('thinking' in b) delete b.thinking
    if ('reasoning_effort' in b) delete b.reasoning_effort
  }
}

// Removed duplicate implementation of getModelFamily and isClaudeWeeklyLimit since they are now imported from family-rate-limiting.ts
