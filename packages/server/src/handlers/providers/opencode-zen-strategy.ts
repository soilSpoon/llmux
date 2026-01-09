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
}

const opencodeZenStrategy = new OpencodeZenStrategy()
registerProviderStrategy(opencodeZenStrategy)

export { opencodeZenStrategy }
