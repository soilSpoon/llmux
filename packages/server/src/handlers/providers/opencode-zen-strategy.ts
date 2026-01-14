/**
 * OpencodeZenStrategy
 *
 * Handles request preparation for Opencode Zen provider.
 * Routes to different protocols based on model name.
 */

import { createLogger } from '@llmux/core'
import {
  fixOpencodeZenBody,
  getOpencodeZenEndpoint,
  resolveOpencodeZenProtocol,
} from '../../providers/opencode-zen'
import type {
  ErrorContext,
  ErrorHandlingResult,
  PrepareContextOptions,
  ProviderRequestContext,
  ProviderRequestStrategy,
  RequestMeta,
  RetryState,
} from './provider-strategy'
import { registerProviderStrategy } from './provider-strategy'

const logger = createLogger({ service: 'opencode-zen-strategy' })

export class OpencodeZenStrategy implements ProviderRequestStrategy {
  readonly provider = 'opencode-zen' as const

  async prepareContext(
    options: PrepareContextOptions,
    _retryState: RetryState
  ): Promise<ProviderRequestContext | null> {
    const { model, reqId } = options

    const protocol = resolveOpencodeZenProtocol(model)
    if (!protocol) {
      logger.warn({ reqId, model }, 'Could not resolve protocol for Opencode Zen model')
      return null
    }

    const endpoint =
      protocol === 'gemini'
        ? getOpencodeZenEndpoint(protocol, model)
        : getOpencodeZenEndpoint(protocol)

    return {
      provider: 'opencode-zen',
      headers: {
        'Content-Type': 'application/json',
      },
      endpoint,
      accountIndex: 0,
    }
  }

  adjustTransformedBody(body: Record<string, unknown>, meta: RequestMeta): Record<string, unknown> {
    fixOpencodeZenBody(body, { thinkingEnabled: meta.thinkingEnabled })
    return body
  }

  async handleError(
    context: ErrorContext,
    _retryState: RetryState
  ): Promise<ErrorHandlingResult | null> {
    const { status, errorText, reqId, model } = context

    // Handle specific 500 error that indicates a rate limit/upstream issue in Opencode Zen
    if (status === 500) {
      try {
        // "Cannot read properties of undefined (reading 'prompt_tokens')"
        // This specific error happens when Opencode Zen fails to get usage from upstream, often due to rate limits/overload
        if (errorText.includes("Cannot read properties of undefined (reading 'prompt_tokens')")) {
          logger.warn(
            { reqId, model, errorText },
            'Detected Opencode Zen upstream failure (prompt_tokens error), treating as rate limit'
          )

          // Simulate 429 behavior
          // 1. Mark as rate limited in router if available
          if (context.router) {
            // Use a default backoff for this specific error
            context.router.handleRateLimit(model, 30000)

            // Try to find a fallback
            const targetModel = context.currentProjectId ? model : context.model || model
            try {
              const routeResult = await context.router.resolveModel(targetModel)
              if (routeResult.provider !== 'opencode-zen' || routeResult.model !== model) {
                return {
                  action: 'switch-model',
                  newModel: routeResult.model,
                  newProvider: routeResult.provider,
                }
              }
            } catch (err) {
              logger.warn({ reqId, err }, 'Failed to resolve fallback for Opencode Zen 500 error')
            }
          }

          // If no router or no fallback found, mark as all cooldown to let dispatcher handle it
          return { action: 'all-cooldown' }
        }
      } catch (err) {
        logger.error({ reqId, err }, 'Error parsing Opencode Zen error response')
      }
    }

    return null
  }
}

const opencodeZenStrategy = new OpencodeZenStrategy()
registerProviderStrategy(opencodeZenStrategy)

export { opencodeZenStrategy }
