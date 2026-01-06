/**
 * OpenAIWebStrategy
 *
 * Handles request preparation for OpenAI Web provider.
 * Uses OpenAI web interface credentials and Codex body format.
 */

import { createLogger } from '@llmux/core'
import { buildCodexBody, prepareOpenAIWebRequest } from '../../providers/openai-web'
import type {
  PrepareContextOptions,
  ProviderRequestContext,
  ProviderRequestStrategy,
  RequestMeta,
  RetryState,
} from './provider-strategy'
import { registerProviderStrategy } from './provider-strategy'

const logger = createLogger({ service: 'openai-web-strategy' })

export class OpenAIWebStrategy implements ProviderRequestStrategy {
  readonly provider = 'openai-web' as const

  async prepareContext(
    options: PrepareContextOptions,
    retryState: RetryState
  ): Promise<ProviderRequestContext | null> {
    const { model, accountIndex, reqId } = options

    const openaiWebContext = await prepareOpenAIWebRequest({
      model,
      accountIndex: retryState.accountIndex || accountIndex,
      reqId,
    })

    if (!openaiWebContext) {
      throw new Error('No credentials available for OpenAI Web')
    }

    retryState.accountIndex = openaiWebContext.accountIndex

    logger.debug(
      { reqId, accountIndex: openaiWebContext.accountIndex },
      'OpenAI Web context prepared'
    )

    return {
      provider: 'openai-web',
      headers: openaiWebContext.headers,
      endpoint: openaiWebContext.endpoint,
      accountIndex: openaiWebContext.accountIndex,
      credentials: openaiWebContext.credentials,
    }
  }

  async adjustTransformedBody(
    body: Record<string, unknown>,
    meta: RequestMeta
  ): Promise<Record<string, unknown>> {
    const { model } = meta

    // Get messages from transformed body or original body
    let messages = body.messages as unknown[] | undefined
    if (!messages || (Array.isArray(messages) && messages.length === 0)) {
      messages = (body.input as unknown[]) || []
    }

    const typedBody = body as {
      tools?: Array<{
        type?: string
        name?: string
        description?: string
        parameters?: unknown
        input_schema?: unknown
        function?: {
          name?: string
          description?: string
          parameters?: unknown
        }
      }>
      reasoning?: unknown
      thinking?: unknown
    }

    return buildCodexBody({
      model,
      messages: messages as Array<{ role: string; content: unknown }>,
      tools: typedBody.tools,
      reasoning: typedBody.reasoning || typedBody.thinking,
    })
  }
}

const openaiWebStrategy = new OpenAIWebStrategy()
registerProviderStrategy(openaiWebStrategy)

export { openaiWebStrategy }
