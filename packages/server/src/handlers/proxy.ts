import {
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  AuthProviderRegistry,
  TokenRefresh,
} from '@llmux/auth'
import { createLogger, isValidProviderName, type ProviderName, transformRequest } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { fixOpencodeZenBody, prepareAntigravityRequest } from '../providers'
import { buildUpstreamHeaders, getDefaultEndpoint, parseRetryAfterMs } from '../upstream'
import { accountRotationManager } from './account-rotation'
import { accumulateGeminiResponse, transformGeminiSseResponse } from './gemini-response'
import {
  createRetryState,
  handleUpstreamError,
  incrementAttempt,
  prepareRequestContext,
  rotateAntigravityEndpoint,
  shouldContinueRetry,
} from './request-handler'
import { handleJsonResponse } from './response-utils'
import type { ProxyOptions } from './types'

const logger = createLogger({ service: 'proxy-handler' })

interface ThinkingConfig {
  type?: string
  budget?: number
}

export type { ProxyOptions } from './types'

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  const reqId = Math.random().toString(36).slice(2, 8)
  const targetProviderInput = options.targetProvider
  if (!isValidProviderName(targetProviderInput)) {
    return new Response(JSON.stringify({ error: `Invalid provider: ${targetProviderInput}` }), {
      status: 400,
    })
  }

  try {
    const body = (await request.json()) as {
      model?: string
      stream?: boolean
      thinking?: ThinkingConfig | boolean
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

    const { isThinkingEnabled } = ctx
    const { currentModel, effectiveProvider: effectiveTargetProvider } = ctx

    let lastResponse: Response | undefined
    const currentProvider = effectiveTargetProvider
    const retryState = createRetryState()

    while (shouldContinueRetry(retryState)) {
      incrementAttempt(retryState)
      let endpoint: string
      let headers: Record<string, string>
      let effectiveCredentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      let currentProjectId: string | undefined

      // Resolve Antigravity project before transforming request
      if (currentProvider === 'antigravity') {
        const antigravityContext = await prepareAntigravityRequest({
          model: currentModel || '',
          accountIndex: retryState.accountIndex,
          overrideProjectId: retryState.overrideProjectId,
          streaming: false,
        })
        if (antigravityContext) {
          effectiveCredentials = antigravityContext.credentials
          retryState.accountIndex = antigravityContext.accountIndex
          currentProjectId = antigravityContext.projectId
        }
      }

      // Prepare Request Body
      const transformedRequest = transformRequest(body, {
        from: formatToProvider(options.sourceFormat),
        to: currentProvider,
        model: currentModel,
        thinkingOverride: isThinkingEnabled !== true ? { enabled: false } : undefined,
        metadata:
          currentProvider === 'antigravity'
            ? { project: currentProjectId, model: currentModel }
            : undefined,
      }) as Record<string, unknown>

      logger.debug(
        {
          attempt: retryState.attempt,
          currentProvider,
          currentModel,
          isThinkingEnabled,
          originalModel: ctx.originalModel,
          transformedRequestModel: transformedRequest.model,
        },
        'Proxy request prepared (pre-alias)'
      )

      logger.debug(
        {
          transformedModel: transformedRequest.model,
          transformedProject: transformedRequest.project,
          hasRequest: !!transformedRequest.request,
        },
        'Request prepared'
      )

      if (currentProvider === 'opencode-zen') {
        fixOpencodeZenBody(transformedRequest, { thinkingEnabled: isThinkingEnabled })
      }

      // Auth & Endpoint
      const currentAuthProvider = AuthProviderRegistry.get(currentProvider)
      if (currentAuthProvider && !options.apiKey) {
        // ... Auth provider logic (similar to streaming but for proxy)
        try {
          effectiveCredentials = await TokenRefresh.ensureFresh(currentProvider)
        } catch {
          return new Response(JSON.stringify({ error: `No credentials for ${currentProvider}` }), {
            status: 401,
          })
        }

        retryState.accountIndex = accountRotationManager.getNextAvailable(
          currentProvider,
          effectiveCredentials || []
        )
        const credential = effectiveCredentials?.[retryState.accountIndex]
        if (!credential)
          return new Response(JSON.stringify({ error: 'No credentials' }), { status: 401 })

        // Special handling for Antigravity endpoint (force streaming URL for consistency or specific requirement?)
        // The original code forced streaming endpoint for Antigravity in proxy.ts too
        endpoint = currentAuthProvider.getEndpoint(options.targetModel || currentModel || '', {
          streaming: false,
        })
        if (currentProvider === 'antigravity') {
          // Respect endpoint rotation
          const baseUrl =
            ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
            ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
          endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
        }

        headers = await currentAuthProvider.getHeaders(credential, {
          model: options.targetModel || currentModel,
        })
      } else {
        endpoint = getDefaultEndpoint(currentProvider, { streaming: false }) || ''
        if (!endpoint)
          return new Response(JSON.stringify({ error: `Unknown provider: ${currentProvider}` }), {
            status: 400,
          })
        headers = buildUpstreamHeaders(currentProvider, options.apiKey)
      }

      try {
        const requestBody = JSON.stringify(transformedRequest)
        logger.debug(
          {
            attempt: retryState.attempt,
            currentProvider,
            endpoint: endpoint.slice(0, 100),
            bodySize: requestBody.length,
            model: transformedRequest.model,
          },
          'Sending upstream request'
        )

        lastResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: requestBody,
        })

        logger.debug(
          {
            attempt: retryState.attempt,
            status: lastResponse.status,
            statusText: lastResponse.statusText,
            contentLength: lastResponse.headers.get('content-length'),
          },
          `Upstream response received`
        )

        if (!lastResponse.ok && lastResponse.status >= 400) {
          const errorText = await lastResponse
            .clone()
            .text()
            .catch(() => 'unable to read')
          logger.error(
            {
              status: lastResponse.status,
              attempt: retryState.attempt,
              endpoint: endpoint.slice(0, 80),
              errorText: errorText.slice(0, 200),
              model: transformedRequest.model,
              project: transformedRequest.project,
            },
            'Upstream error response'
          )
        }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            attempt: retryState.attempt,
          },
          'Upstream fetch error'
        )

        if (currentProvider === 'antigravity') {
          rotateAntigravityEndpoint(retryState)
          if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
            logger.warn(
              { reqId, newEndpointIndex: retryState.antigravityEndpointIndex },
              'Antigravity network error, rotating endpoint'
            )
            // Don't sleep if just rotating endpoint? Or sleep a bit?
            // Maybe small sleep.
            await new Promise((r) => setTimeout(r, 200))
            continue
          }
        }

        await new Promise((r) => setTimeout(r, 1000))
        continue
      }

      if (!lastResponse.ok) {
        const errorText = await lastResponse
          .clone()
          .text()
          .catch(() => '')

        const retryAfterMs = parseRetryAfterMs(lastResponse, errorText) || 30000

        const result = await handleUpstreamError({
          provider: currentProvider,
          model: currentModel || '',
          status: lastResponse.status,
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

        if (result.action === 'switch-model' && result.newModel) {
          logger.warn('Model fallback requested but not fully supported in proxy handler yet')
        }
      }

      break // Success or non-retriable error
    }

    if (!lastResponse)
      return new Response(JSON.stringify({ error: 'Request failed' }), { status: 500 })

    // Handle Response Transformation
    const contentType = lastResponse.headers.get('content-type') || ''

    // Convert SSE to JSON if needed
    if (contentType.includes('text/event-stream') && !body.stream) {
      const reader = lastResponse.body?.getReader() as
        | ReadableStreamDefaultReader<Uint8Array>
        | undefined
      if (!reader) throw new Error('No body')

      const finalResponse = await accumulateGeminiResponse(reader)

      if (!finalResponse) {
        return new Response(JSON.stringify({ error: 'Failed to parse SSE response' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const transformed = transformGeminiSseResponse(
        finalResponse,
        currentProvider,
        formatToProvider(options.sourceFormat)
      )

      return new Response(JSON.stringify(transformed), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Standard JSON Response
    if (contentType.includes('application/json')) {
      return handleJsonResponse(lastResponse, {
        currentProvider,
        sourceFormat: options.sourceFormat,
      })
    }

    return new Response(lastResponse.body, {
      status: lastResponse.status,
      headers: lastResponse.headers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
