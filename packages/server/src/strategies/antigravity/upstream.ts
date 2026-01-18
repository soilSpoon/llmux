import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
} from '@llmux/auth'
import type {
  PrepareUpstreamOptions,
  UpstreamContext,
  UpstreamPreparationStrategy,
} from '@llmux/core'
import { prepareAntigravityRequest } from '../../providers/antigravity'

export class AntigravityUpstreamStrategy implements UpstreamPreparationStrategy {
  readonly strategyType = 'upstream'

  async prepare(options: PrepareUpstreamOptions): Promise<UpstreamContext> {
    const { model, accountIndex, overrideProjectId, streaming, reqId, retryEndpointIndex } = options

    const antigravityContext = await prepareAntigravityRequest({
      model,
      accountIndex,
      overrideProjectId: overrideProjectId || null,
      streaming,
      reqId,
      retryEndpointIndex,
    })

    if (!antigravityContext) {
      throw new Error(`No credentials available for Antigravity (all rate-limited)`)
    }

    const endpointIndex = retryEndpointIndex || 0
    let endpoint = antigravityContext.endpoint

    if (!endpoint) {
      const baseUrl =
        ANTIGRAVITY_ENDPOINT_FALLBACKS[endpointIndex] || ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
      endpoint = streaming
        ? `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
        : `${baseUrl}${ANTIGRAVITY_API_PATH_GENERATE}`
    }

    // Add anthropic-beta header if interleaved thinking is enabled
    if (options.thinkingPolicy?.mode === 'interleaved') {
      antigravityContext.headers['anthropic-beta'] = 'output-128k-2025-02-19'
    }

    return {
      accountIndex: antigravityContext.accountIndex,
      projectId: antigravityContext.projectId,
      endpoint,
      headers: antigravityContext.headers,
      account: antigravityContext.account,
      providerInfo: {
        antigravity: {
          endpoint,
          account: antigravityContext.account,
        },
      },
    }
  }
}
