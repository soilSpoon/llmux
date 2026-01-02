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
  prepareAntigravityRequest,
  prepareOpenAIWebRequest,
} from '../providers'
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
  createConversationContextHash,
  ensureThinkingSignatures,
  extractConversationKey,
  shouldCacheSignatures,
} from './signature-integration'
import { createStreamTransformer, type StreamContext } from './stream-transformer'
import type { ProxyOptions } from './types'

const logger = createLogger({ service: 'streaming-handler' })

export type { ProxyOptions } from './types'

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
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
    targetProvider: options.targetProvider,
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
      // console.log('DEBUG: Loop start, attempt:', retryState.attempt)

      if (options.router) {
        const resolution = await options.router.resolveModel(currentModel)
        currentProvider = resolution.provider as ProviderName
        currentModel = resolution.model
      }
      effectiveTargetProvider = currentProvider

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
          Object.assign(headers, antigravityContext.headers)
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
      let contextHash: string | undefined
      if (shouldCacheSignaturesForModel) {
        const conversationKey = extractConversationKey(body)
        signatureSessionKey = buildSignatureSessionKey(
          currentModel,
          conversationKey,
          effectiveTargetProvider
        )
        // Generate context hash for signature validation
        const typedBody = body as { contents?: unknown[]; messages?: unknown[] }
        contextHash = createConversationContextHash(
          typedBody.contents as Parameters<typeof createConversationContextHash>[0],
          typedBody.messages as Parameters<typeof createConversationContextHash>[1]
        )
        await ensureThinkingSignatures(requestBody, signatureSessionKey, currentModel)
      }

      // Endpoint
      let endpoint =
        openaiWebEndpoint || getDefaultEndpoint(effectiveTargetProvider, { streaming: true })
      if (!endpoint) throw new Error(`No endpoint for ${effectiveTargetProvider}`)

      // Antigravity Specific Post-Transform Logic
      if (effectiveTargetProvider === 'antigravity') {
        // Endpoint rotation for antigravity
        const baseUrl =
          ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
          ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
        endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
      }

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

          throw new Error(`Upstream error ${status}: ${errorText}`)
        }

        // Success! Transform stream
        if (!upstreamResponse.body) throw new Error('No response body')

        const transformStream = createStreamTransformer({
          reqId,
          startTime,
          sourceFormat: options.sourceFormat,
          targetProvider: effectiveTargetProvider,
          streamContext,
          shouldCacheSignaturesForModel,
          signatureSessionKey,
          contextHash,
        })

        upstreamResponse.body.pipeTo(transformStream.writable).catch((error) => {
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
