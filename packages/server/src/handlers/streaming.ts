import { ANTIGRAVITY_API_PATH_STREAM, ANTIGRAVITY_ENDPOINT_FALLBACKS } from '@llmux/auth'
import {
  createLogger,
  type ProviderName,
  stripSignaturesFromContents,
  stripSignaturesFromMessages,
  transformRequest,
} from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import {
  buildCodexBody,
  fixOpencodeZenBody,
  getOpencodeZenEndpoint,
  prepareAntigravityRequest,
  prepareOpenAIWebRequest,
  resolveOpencodeZenProtocol,
} from '../providers'
import { SignatureStore } from '../stores'
import { buildUpstreamHeaders, getDefaultEndpoint, parseRetryAfterMs } from '../upstream'
import {
  createRetryState,
  handleUpstreamError,
  incrementAttempt,
  prepareRequestContext,
  removeThinkingFromBody,
  rotateAntigravityEndpoint,
  shouldContinueRetry,
} from './request-handler'
import {
  buildSignatureSessionKey,
  ensureThinkingSignatures,
  extractConversationKey,
  shouldCacheSignatures,
} from './signature-integration'
import { validateAndStripSignatures } from './signature-request'
import { createStreamTransformer, type StreamContext } from './stream-transformer'
import type { ProxyOptions } from './types'

const logger = createLogger({ service: 'streaming-handler' })

const signatureStore = new SignatureStore()

export type { ProxyOptions } from './types'

export function getSignatureStore(): SignatureStore {
  return signatureStore
}

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

class NonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetriableError'
  }
}

function resolveStreamEndpoint(
  provider: string,
  model: string,
  retryState: { antigravityEndpointIndex: number },
  openaiWebEndpoint?: string
): string {
  // 1. OpenAI Web
  if (provider === 'openai-web' && openaiWebEndpoint) {
    return openaiWebEndpoint
  }

  // 2. Opencode Zen (Dynamic Protocol)
  if (provider === 'opencode-zen') {
    const protocol = resolveOpencodeZenProtocol(model)
    if (protocol) {
      return getOpencodeZenEndpoint(protocol)
    }
  }

  // 3. Antigravity (Endpoint Rotation)
  if (provider === 'antigravity') {
    const baseUrl =
      ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
      ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
    return `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
  }

  // 4. Default
  const endpoint = getDefaultEndpoint(provider, { streaming: true })
  if (!endpoint) {
    throw new Error(`No endpoint for ${provider}`)
  }
  return endpoint
}

export async function handleStreamingProxy(
  request: Request,
  options: ProxyOptions
): Promise<Response> {
  const startTime = Date.now()
  const reqId = Math.random().toString(36).slice(2, 8)

  const streamContext: StreamContext = {
    reqId,
    fromFormat: options.sourceFormat,
    targetProvider: options.targetProvider || 'unknown',
    targetModel: options.targetModel || 'unknown',
    originalModel: 'unknown',
    finalModel: 'unknown',
    chunkCount: 0,
    totalBytes: 0,
    duration: 0,
    fullResponse: '',
    accumulatedText: '',
    accumulatedThinking: '',
  }

  try {
    const body = (await request.json()) as {
      model?: string
      thinking?: { type?: string; budget_tokens?: number } | unknown
      reasoning_effort?: unknown
      messages?: Array<{
        role: string
        content: Array<{ type?: string; signature?: string }> | string
      }>
      [key: string]: unknown
    }

    // Use shared request context preparation
    const ctx = await prepareRequestContext({
      body,
      sourceFormat: options.sourceFormat,
      targetProvider: options.targetProvider,
      targetModel: options.targetModel,
      thinking: options.thinking,
      router: options.router,
      modelMappings: options.modelMappings,
    })

    const { originalModel, isThinkingEnabled } = ctx
    let { currentModel, effectiveProvider: effectiveTargetProvider } = ctx
    streamContext.originalModel = originalModel

    let currentProvider = effectiveTargetProvider
    let previousProvider = effectiveTargetProvider
    let previousModel = currentModel
    const retryState = createRetryState()

    while (shouldContinueRetry(retryState)) {
      incrementAttempt(retryState)

      if (isThinkingEnabled !== true) {
        removeThinkingFromBody(body)
      }

      let currentProjectId: string | undefined

      streamContext.targetProvider = currentProvider
      streamContext.finalModel = currentModel || 'unknown'
      effectiveTargetProvider = currentProvider

      const headers = buildUpstreamHeaders(effectiveTargetProvider, options.apiKey, {
        fromProtocol: currentModel
          ? currentModel.includes('claude')
            ? 'anthropic'
            : undefined
          : undefined,
      })

      // Antigravity Specific Pre-Transform Logic
      let currentEndpoint = ''
      let currentAccount = ''
      if (effectiveTargetProvider === 'antigravity') {
        const antigravityContext = await prepareAntigravityRequest({
          model: currentModel,
          accountIndex: retryState.accountIndex,
          overrideProjectId: retryState.overrideProjectId,
          streaming: true,
          reqId,
        })
        if (antigravityContext) {
          retryState.accountIndex = antigravityContext.accountIndex
          currentProjectId = antigravityContext.projectId
          currentEndpoint = antigravityContext.endpoint || ''
          currentAccount = antigravityContext.account || ''
          Object.assign(headers, antigravityContext.headers)
        }
      }

      // Signature Validation: Strip invalid signatures before transform
      if (currentProjectId && body.messages) {
        const validationResult = validateAndStripSignatures({
          messages: body.messages as Parameters<typeof validateAndStripSignatures>[0]['messages'],
          targetProjectId: currentProjectId,
          signatureStore,
        })
        if (validationResult.strippedCount > 0) {
          logger.info(
            { reqId, projectId: currentProjectId, strippedCount: validationResult.strippedCount },
            `Validating signatures for project: ${currentProjectId} - stripped ${validationResult.strippedCount} invalid signatures`
          )
          body.messages = validationResult.messages as typeof body.messages
        }
      }

      // OpenAI Web Specific Pre-Transform Logic
      let openaiWebEndpoint: string | undefined
      if (effectiveTargetProvider === 'openai-web') {
        const openaiWebContext = await prepareOpenAIWebRequest({
          model: currentModel,
          accountIndex: retryState.accountIndex,
          reqId,
        })
        if (openaiWebContext) {
          retryState.accountIndex = openaiWebContext.accountIndex
          Object.assign(headers, openaiWebContext.headers)
          openaiWebEndpoint = openaiWebContext.endpoint
        } else {
          throw new Error('No OpenAI Web credentials available')
        }
      }

      // Transform Request (Now with projectId context if available)
      let transformedRequest: unknown
      try {
        transformedRequest = transformRequest(body, {
          from: formatToProvider(options.sourceFormat),
          to: effectiveTargetProvider,
          model: currentModel,
          thinkingOverride: isThinkingEnabled !== true ? { enabled: false } : undefined,
          metadata: { project: currentProjectId, model: currentModel },
        })

        const modelChanged = previousProvider !== currentProvider || previousModel !== currentModel
        const requestBody = transformedRequest as Record<string, unknown>
        const hasContents =
          effectiveTargetProvider === 'antigravity' &&
          (requestBody.request as Record<string, unknown> | undefined)?.contents

        if (modelChanged && hasContents) {
          const innerRequest = requestBody.request as Record<string, unknown>
          const contents = innerRequest.contents as Array<{
            role: string
            parts: Array<{ thoughtSignature?: string; [key: string]: unknown }>
          }>
          if (Array.isArray(contents)) {
            innerRequest.contents = stripSignaturesFromContents(contents)
          }
        }

        // Also strip signatures from Anthropic messages format (before transform)
        if (modelChanged && Array.isArray(body.messages)) {
          body.messages = stripSignaturesFromMessages(body.messages)
        }

        previousProvider = currentProvider
        previousModel = currentModel
      } catch (error) {
        streamContext.error = error instanceof Error ? error.message : String(error)
        throw error
      }

      let requestBody = transformedRequest as Record<string, unknown>

      // Provider-specific Body Adjustments
      if (effectiveTargetProvider === 'openai-web') {
        logger.debug(
          {
            reqId,
            bodyKeys: Object.keys(body),
            hasMessages: !!body.messages,
            transformedKeys: Object.keys(requestBody),
            transformedHasMessages: !!requestBody.messages,
          },
          '[openai-web] Debugging body'
        )

        const typedBody = body as Record<string, unknown>
        // Try to use transformed messages if available (converted to OpenAI format), otherwise fallback to raw body
        const messages = requestBody.messages || typedBody.messages

        requestBody = await buildCodexBody({
          model: currentModel,
          messages: messages as unknown[],
          tools: typedBody.tools as Parameters<typeof buildCodexBody>[0]['tools'],
          reasoning: (typedBody.reasoning || typedBody.thinking) as unknown,
        })
      }

      if (effectiveTargetProvider === 'opencode-zen') {
        fixOpencodeZenBody(requestBody)
      }

      // Signature Integration
      const shouldCacheSignaturesForModel = shouldCacheSignatures(currentModel)
      let signatureSessionKey: string | undefined
      if (shouldCacheSignaturesForModel) {
        const conversationKey = extractConversationKey(body)
        signatureSessionKey = buildSignatureSessionKey(
          currentModel,
          conversationKey,
          effectiveTargetProvider
        )
        await ensureThinkingSignatures(requestBody, signatureSessionKey, currentModel)
      }

      // Endpoint Resolution
      const endpoint = resolveStreamEndpoint(
        effectiveTargetProvider,
        currentModel,
        retryState,
        openaiWebEndpoint
      )

      const controller = new AbortController()
      const signal = controller.signal

      streamContext.requestInfo = {
        model: currentModel,
        provider: effectiveTargetProvider,
        endpoint,
        toolsCount: (body as { tools?: unknown[] }).tools?.length || 0,
        bodyLength: JSON.stringify(requestBody).length,
      }

      try {
        const upstreamResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal,
        })

        if (!upstreamResponse.ok) {
          const errorText = await upstreamResponse.text()
          const status = upstreamResponse.status
          let retryAfterMs = 30000
          try {
            retryAfterMs = parseRetryAfterMs(upstreamResponse, errorText)
          } catch {
            // Ignore parsing error
          }

          const result = await handleUpstreamError({
            reqId,
            provider: effectiveTargetProvider,
            model: currentModel,
            originalModel,
            status,
            errorText,
            retryState,
            currentProjectId,
            router: options.router,
            retryAfterMs,
          })

          if (result.action === 'retry') {
            if (result.delay) await new Promise((r) => setTimeout(r, result.delay))
            continue
          }

          if (result.action === 'switch-model' && result.newModel) {
            logger.warn(
              {
                oldModel: currentModel,
                newModel: result.newModel,
                newProvider: result.newProvider,
              },
              'Switching model/provider due to fallback'
            )
            currentModel = result.newModel
            if (result.newProvider) {
              // Update both currentProvider and effectiveTargetProvider as streaming handler uses both differently
              // currentProvider seems to be used for logic, effectiveTargetProvider for headers/requests
              currentProvider = result.newProvider
              effectiveTargetProvider = result.newProvider
            }
            // Reset retry state for new model
            retryState.accountIndex = 0
            retryState.antigravityEndpointIndex = 0
            retryState.overrideProjectId = null
            retryState.attempt = 0
            continue
          }

          if (result.action === 'all-cooldown') {
            return new Response(
              JSON.stringify({
                error: {
                  message:
                    'All available models and providers are currently rate-limited. Please try again later.',
                  type: 'rate_limit_error',
                  code: 'all_providers_cooldown',
                },
              }),
              {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          }

          // If action is throw (non-retriable error), stop retrying and return error
          // We throw here to be caught by the outer catch, but we add a flag or specific error type
          // to avoid it being treated as a network error if we wanted to distinguish.
          // However, the outer catch wraps in 500.
          // To avoid the retry loop catching it, we must NOT throw inside the try block that has the catch for retries?
          // The try/catch is inside the while loop.
          // We should break the loop or return directly.

          throw new NonRetriableError(`Upstream error ${status}: ${errorText}`)
        }

        // Success! Transform stream
        if (!upstreamResponse.body) throw new Error('No response body')

        // Reset cooldown backoff on success
        if (options.router?.handleSuccess) {
          options.router.handleSuccess(effectiveTargetProvider, currentModel)
        }

        const transformStream = createStreamTransformer({
          reqId,
          startTime,
          sourceFormat: options.sourceFormat,
          targetProvider: effectiveTargetProvider,
          streamContext,
          signatureContext: currentProjectId
            ? {
                projectId: currentProjectId,
                provider: effectiveTargetProvider,
                endpoint: currentEndpoint,
                account: currentAccount,
                signatureStore,
                onSave: (count) => {
                  logger.debug(
                    { reqId, projectId: currentProjectId, count },
                    `Saved ${count} signatures for project: ${currentProjectId}`
                  )
                },
              }
            : undefined,
        })

        const bodyStream = upstreamResponse.body
        bodyStream.pipeTo(transformStream.writable).catch((error) => {
          streamContext.error = error instanceof Error ? error.message : String(error)
          logger.error({ reqId, error: streamContext.error }, '[Streaming] Pipe Error')
        })

        return new Response(transformStream.readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      } catch (error) {
        // Handle NonRetriableError by re-throwing to exit the loop
        if (error instanceof NonRetriableError) {
          throw error
        }

        // Loop continue for retries handled by 'continue' in try block
        // If we are here, it's a hard error or rethrow

        const message = error instanceof Error ? error.message : String(error)
        logger.error({ reqId, error: message, attempt: retryState.attempt }, 'Upstream fetch error')

        if (currentProvider === 'antigravity') {
          rotateAntigravityEndpoint(retryState)
          if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
            logger.warn(
              { reqId, newEndpointIndex: retryState.antigravityEndpointIndex },
              'Antigravity network error, rotating endpoint'
            )
            await new Promise((r) => setTimeout(r, 200))
            continue
          }
        }

        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    return new Response(
      JSON.stringify({
        error: {
          message: 'Unexpected end of retry loop',
          type: 'internal_error',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const duration = Date.now() - startTime
    const message = error instanceof Error ? error.message : 'Unknown error'
    streamContext.error = message
    const sanitize = (s: string) =>
      s
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const ri = streamContext.requestInfo || {
      model: 'unknown',
      provider: 'unknown',
      endpoint: '',
      toolsCount: 0,
      bodyLength: 0,
    }
    const logMsg = `[Streaming] ${streamContext.reqId} | ${ri.model} (${ri.provider}) | Tools:${ri.toolsCount} | ReqLen:${ri.bodyLength} | ${duration}ms | ERROR: ${sanitize(message)}`
    logger.error(logMsg)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
