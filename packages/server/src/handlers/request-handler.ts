import type { ProviderName } from '@llmux/core'
import { createLogger, isValidProviderName } from '@llmux/core'
import type { ModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import type { Router } from '../routing'
import { NonRetriableError } from './error-utils'
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

  if (!effectiveProvider || effectiveProvider === 'unknown') {
    throw new NonRetriableError(
      `Could not resolve provider for model "${currentModel}" (original: "${originalModel}"). Please check your routing configuration or provide a default provider.`,
      400
    )
  }

  return {
    originalModel,
    currentModel,
    effectiveProvider,
    isThinkingEnabled,
    sourceFormat,
  }
}

export function removeThinkingFromBody(body: unknown): void {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('thinking' in b) delete b.thinking
    if ('reasoning_effort' in b) delete b.reasoning_effort
  }
}

// Re-export functions that were moved to rate-limit-handler.ts
export {
  createRetryState,
  handleUpstreamError,
  incrementAttempt,
  MAX_RETRY_ATTEMPTS,
  shouldContinueRetry,
} from './rate-limit-handler'
// Re-export types that were moved to types.ts for backward compatibility during refactor
export type { ErrorHandlingContext, ErrorHandlingResult, RetryState } from './types'
