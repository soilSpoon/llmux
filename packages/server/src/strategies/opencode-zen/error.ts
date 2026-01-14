import { createLogger, type ProviderName } from '@llmux/core'
import type {
  ErrorHandlingAction,
  ErrorHandlingOptions,
  ErrorHandlingStrategy,
} from '@llmux/core/types/provider-strategies'
import type { RetryState } from '../../handlers/types'
import type { Router } from '../../routing'

const logger = createLogger({ service: 'opencode-zen-error-strategy' })

export interface OpencodeZenErrorOptions extends ErrorHandlingOptions {
  router?: Router
  retryState?: RetryState
  reqId?: string
}

export class OpencodeZenErrorStrategy implements ErrorHandlingStrategy {
  readonly strategyType = 'errorHandling' as const

  async handleError(options: ErrorHandlingOptions): Promise<ErrorHandlingAction | null> {
    const { status, errorText, model, provider, originalModel } = options
    const { router, reqId } = options as OpencodeZenErrorOptions

    // Handle specific 500 error that indicates a rate limit/upstream issue in Opencode Zen
    if (status === 500) {
      if (errorText.includes("Cannot read properties of undefined (reading 'prompt_tokens')")) {
        logger.warn(
          { reqId, model, errorText },
          'Detected Opencode Zen upstream failure (prompt_tokens error), treating as rate limit'
        )

        if (router) {
          // Notify router of rate limit to avoid immediate retry of the same model
          router.handleRateLimit(model, 30000)

          const targetModel = originalModel && originalModel !== 'unknown' ? originalModel : model

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
            logger.warn(
              { reqId, targetModel, err },
              'Failed to resolve fallback for Opencode Zen 500 error'
            )
          }
        }

        return { action: 'all-cooldown' }
      }
    }

    return null
  }
}
