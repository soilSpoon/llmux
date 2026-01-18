import { createLogger, type ProviderName } from '@llmux/core'
import type {
  ErrorHandlingAction,
  ErrorHandlingOptions,
  ErrorHandlingStrategy,
} from '@llmux/core/types/provider-strategies'
import type { Router } from '../../routing'

const logger = createLogger({ service: 'github-copilot-error-strategy' })

export interface GithubCopilotErrorOptions extends ErrorHandlingOptions {
  router?: Router
  reqId?: string
}

export class GithubCopilotErrorStrategy implements ErrorHandlingStrategy {
  readonly strategyType = 'errorHandling' as const

  async handleError(options: ErrorHandlingOptions): Promise<ErrorHandlingAction | null> {
    const { status, model, provider, originalModel } = options
    const { router, reqId } = options as GithubCopilotErrorOptions

    // Handle 401/403 (Auth failures)
    if (status === 401 || status === 403) {
      logger.warn(
        { reqId, model, status },
        'Detected GitHub Copilot auth failure, treating as cooldown/fallback'
      )

      if (router) {
        // Mark as rate limited (cooldown) to skip this model/provider for a while
        // Use a longer cooldown for auth errors (e.g. 5 minutes)
        router.handleRateLimit(model, 5 * 60 * 1000)

        // Try to resolve next fallback
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
            'Failed to resolve fallback for GitHub Copilot auth error'
          )
        }
      }

      // If we can't fallback, we should return all-cooldown (429) rather than letting it throw
      // so that it fails gracefully or continues the loop if possible
      return { action: 'all-cooldown' }
    }

    return null
  }
}
