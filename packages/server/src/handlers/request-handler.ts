import { ANTIGRAVITY_ENDPOINT_FALLBACKS, TokenRefresh } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { createLogger, isValidProviderName } from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  isLicenseError,
  shouldFallbackToDefaultProject,
} from '../providers'
import type { Router } from '../routing'
import { getHardcodedModelFallback } from '../routing/model-rules'
import { accountRotationManager } from './account-rotation'
import { applyModelMappingV2 } from './model-mapping'

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
  thinking?: boolean
  router?: Router
  modelMappings?: AmpModelMapping[]
  headerTargetProvider?: string | null
  apiKey?: string
}

export async function prepareRequestContext(
  options: PrepareContextOptions
): Promise<RequestContext> {
  const {
    body,
    sourceFormat,
    targetProvider: optionsTargetProvider,
    targetModel: optionsTargetModel,
    thinking: optionsThinking,
    router,
    modelMappings,
    headerTargetProvider,
  } = options

  const originalModel = body.model ?? 'unknown'
  let currentModel = optionsTargetModel || originalModel
  let initialTargetProvider = optionsTargetProvider

  // Header override
  if (headerTargetProvider) {
    initialTargetProvider = headerTargetProvider
  }

  // Thinking detection
  const hasThinkingInRequest = body.thinking !== undefined || body.reasoning_effort !== undefined
  const thinkingType =
    typeof body.thinking === 'object' && body.thinking !== null && 'type' in body.thinking
      ? (body.thinking as { type?: string }).type
      : undefined

  let isThinkingEnabled: boolean | undefined = hasThinkingInRequest
    ? thinkingType === 'enabled' || body.reasoning_effort !== undefined
    : undefined

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

  if (router && currentModel) {
    // If targetProvider is NOT set, use router.
    // If targetProvider IS set, we generally trust it, BUT we might still want to resolve the model alias.
    // E.g. "claude-3-opus" -> "claude-3-opus-20240229" even if provider is "anthropic".

    // Use router to resolve model aliases and provider
    const routeResult = await router.resolveModel(currentModel)

    // If initialTargetProvider was NOT set, we accept the router's provider.
    if (!initialTargetProvider) {
      effectiveProvider = routeResult.provider as ProviderName
    }

    // We ALWAYS accept the router's resolved model (it handles aliases)
    currentModel = routeResult.model
  }

  if (initialTargetProvider && isValidProviderName(initialTargetProvider)) {
    effectiveProvider = initialTargetProvider as ProviderName
  }

  if (!effectiveProvider) {
    effectiveProvider = 'openai'
  }

  return {
    originalModel,
    currentModel,
    effectiveProvider,
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
  const { reqId, provider, model, status, errorText, retryState, currentProjectId, router } =
    context

  // Antigravity license/quota fallback
  if (provider === 'antigravity') {
    const licenseCtx = {
      errorBody: errorText,
      status,
      currentProject: currentProjectId,
    }

    if (isLicenseError(licenseCtx)) {
      if (shouldFallbackToDefaultProject(licenseCtx) && !retryState.overrideProjectId) {
        setOverrideProjectId(retryState, ANTIGRAVITY_DEFAULT_PROJECT_ID)
        logger.warn(
          { reqId, status, currentProject: currentProjectId },
          'Falling back to default project due to license/permission error'
        )
        return { action: 'retry' }
      }
      // Try next endpoint if license error persists on default project
      rotateAntigravityEndpoint(retryState)
      if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
        return { action: 'retry' }
      }
    } else if (
      status === 403 &&
      currentProjectId !== ANTIGRAVITY_DEFAULT_PROJECT_ID &&
      !retryState.overrideProjectId
    ) {
      // Any 403 should try default project before giving up on the account
      setOverrideProjectId(retryState, ANTIGRAVITY_DEFAULT_PROJECT_ID)
      logger.warn(
        { reqId, currentProjectId },
        'Unexpected 403, trying default project before rotation'
      )
      return { action: 'retry' }
    }
  }

  // Antigravity Endpoint Rotation on Server Errors (5xx)
  if (provider === 'antigravity' && status >= 500) {
    rotateAntigravityEndpoint(retryState)
    if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
      logger.warn(
        { reqId, status, newEndpointIndex: retryState.antigravityEndpointIndex },
        'Antigravity server error, rotating endpoint'
      )
      return { action: 'retry' }
    }
  }

  // Rate limit handling
  if (status === 429) {
    const retryAfter = context.retryAfterMs !== undefined ? context.retryAfterMs : 30000

    logger.warn(
      { reqId, status, retryAfter, originalRetryAfter: context.retryAfterMs },
      'Rate limited'
    )

    // Check hardcoded fallback first (for tests or specific known overrides)
    const hardcodedFallback = getHardcodedModelFallback(model)
    if (hardcodedFallback) {
      logger.warn(
        {
          reqId,
          current: { provider, model },
          fallback: hardcodedFallback,
        },
        'Rate limited, using hardcoded fallback'
      )
      return {
        action: 'switch-model',
        newModel: hardcodedFallback.model,
        newProvider: (hardcodedFallback.provider || provider) as ProviderName,
      }
    }

    // Antigravity: Try rotating endpoints before marking account as limited
    // Different endpoints (Daily vs Prod) might have separate quotas/limits
    if (provider === 'antigravity') {
      rotateAntigravityEndpoint(retryState)
      if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
        logger.warn(
          { reqId, newEndpointIndex: retryState.antigravityEndpointIndex },
          'Antigravity 429, rotating endpoint before rotating account'
        )
        return { action: 'retry' }
      }
    }

    // Mark current as rate limited (all providers)
    // For Antigravity, we only reach here if we've exhausted all endpoints for the current account
    accountRotationManager.markRateLimited(provider, model, retryState.accountIndex, retryAfter)

    // Check if all accounts are limited
    try {
      const credentials = await TokenRefresh.ensureFresh(provider)
      if (credentials && accountRotationManager.areAllRateLimited(provider, model, credentials)) {
        // Router handling: Only mark the model as globally limited if ALL accounts are limited
        if (router && model) {
          router.handleRateLimit(model, retryAfter)
        }

        // 2. Try Router Smart Fallback
        if (router && context.originalModel) {
          const routeResult = await router.resolveModel(context.originalModel)

          // If router found a different provider or model that is NOT the current one
          // (resolveModel checks cooldowns, so it should return a non-cooled-down option if available)
          if (routeResult.provider !== provider || routeResult.model !== model) {
            logger.warn(
              {
                reqId,
                current: { provider, model },
                fallback: { provider: routeResult.provider, model: routeResult.model },
              },
              'All accounts rate limited, router suggested fallback'
            )
            return {
              action: 'switch-model',
              newModel: routeResult.model,
              newProvider: routeResult.provider as ProviderName,
            }
          }
        }

        // If all limited and no fallback found, return 429 to client
        return { action: 'all-cooldown' }
      }
    } catch (err) {
      // Ignore credential errors (e.g. when using API key)
      logger.debug({ err }, 'Failed to check credentials for rate limit')
    }

    if (accountRotationManager.hasNext(provider, model, retryState.accountIndex)) {
      rotateAccount(retryState)
      return { action: 'retry' }
    }

    // If no next account, but not all limited (maybe just this one), we already rotated or failed?
    // If hasNext is false, it means we ran out of accounts?
    // But we checked areAllRateLimited above.

    // Fallback behavior: just retry with delay if nothing else works
    return { action: 'retry', delay: 1000 }
  }

  return { action: 'throw' }
}

export interface RetryContext {
  attempt: number
  maxAttempts: number
  provider: ProviderName
  model: string
  accountId?: number
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
    accountIndex: 0,
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

export function rotateAccount(state: RetryState): void {
  state.accountIndex++
}

export function rotateAntigravityEndpoint(state: RetryState): void {
  state.antigravityEndpointIndex++
}

export function setOverrideProjectId(state: RetryState, projectId: string): void {
  state.overrideProjectId = projectId
}

export function removeThinkingFromBody(body: unknown): void {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('thinking' in b) delete b.thinking
    if ('reasoning_effort' in b) delete b.reasoning_effort
  }
}

export function shouldRetry(
  _error: unknown,
  context: RetryContext,
  _checkNextAccount: (provider: ProviderName, model: string, index: number) => boolean
): { retry: boolean; delay?: number; nextAccount?: boolean } {
  if (context.attempt >= context.maxAttempts) {
    return { retry: false }
  }

  // Rate limit handling is typically done in the loop with response status check
  // This helper is for network errors or other retriable conditions
  return { retry: true, delay: 1000 }
}
