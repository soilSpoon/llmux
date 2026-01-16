import { createLogger, formatIdToProviderName } from '@llmux/core'
import { getRequestLogStore, type SignatureStore } from '../stores'
import { parseRetryAfterMs } from '../upstream'
import { AllCooldownError, parseUpstreamError, type UpstreamErrorInfo } from './error-utils'
import { getProviderStrategy } from './providers/provider-strategy'
import {
  createRetryState,
  handleUpstreamError,
  incrementAttempt,
  type RetryState,
  shouldContinueRetry,
} from './request-handler'
import type { ProxyOptions } from './types'
import type {
  RequestBuilderInput,
  RequestBuilderResult,
  UpstreamRequest,
  UpstreamRequestMeta,
} from './upstream-request-builder'

export type { UpstreamRequestMeta }

const logger = createLogger({ service: 'upstream-dispatcher' })

export class NonRetriableError extends Error {
  errorInfo: UpstreamErrorInfo

  constructor(errorText: string, status: number, provider?: string) {
    const info = parseUpstreamError(errorText, status)
    if (provider) info.provider = provider
    super(info.message)
    this.name = 'NonRetriableError'
    this.errorInfo = info
  }
}

export interface DispatchInput {
  reqId: string
  builder: (input: RequestBuilderInput) => Promise<RequestBuilderResult>
  initialBody: unknown
  options: ProxyOptions
  mode: 'streaming' | 'non-streaming' | 'count_tokens'
  signatureStore: SignatureStore
  onBeforeAttempt?: (attempt: number, meta: UpstreamRequestMeta) => void
  onSuccessfulAttempt?: (meta: UpstreamRequestMeta, response: Response) => void
  // new, all optional
  networkErrorBaseDelayMs?: number
  networkErrorMaxDelayMs?: number
  retryState?: RetryState
  timeoutMs?: number
}

export interface DispatchResult {
  response: Response | null
  meta: UpstreamRequestMeta | null
  retryState: RetryState
  error?: Error
}

export async function dispatchWithRetry(input: DispatchInput): Promise<DispatchResult> {
  const { reqId, builder, initialBody, options, mode, signatureStore } = input

  const retryState =
    input.retryState ||
    createRetryState(
      typeof options.router?.getMaxRetryAttempts === 'function'
        ? options.router.getMaxRetryAttempts()
        : 20
    )
  let lastResponse: Response | undefined
  let lastMeta: UpstreamRequestMeta | null = null
  const startTime = Date.now()
  const preTransformRequest: unknown = initialBody

  while (shouldContinueRetry(retryState)) {
    incrementAttempt(retryState)
    logger.debug({ attempt: retryState.attempt, reqId }, 'Dispatcher loop start')

    let request: UpstreamRequest | undefined
    let postTransformRequest: unknown

    try {
      const requestResult = await builder({
        reqId,
        body: initialBody as Record<string, unknown>,
        options,
        retryState,
        mode,
        signatureStore,
      })

      request = requestResult.request
      lastMeta = request.meta

      postTransformRequest = JSON.parse(request.init.body)

      if (retryState.attempt === 1) {
        try {
          const logStore = getRequestLogStore()
          logStore.logRequest({
            requestId: reqId,
            sourceProvider: formatIdToProviderName(options.sourceFormat) || options.sourceFormat,
            sourceModel: request.meta.originalModel,
            sourceEndpoint: options.sourceFormat,
            targetProvider: request.meta.provider,
            targetModel: request.meta.model,
            targetEndpoint: request.endpoint,
            preTransformRequest,
            postTransformRequest,
            isStreaming: mode === 'streaming',
          })
        } catch (logErr) {
          logger.warn({ reqId, error: String(logErr) }, 'Failed to log request to SQLite')
        }
      }

      if (input.onBeforeAttempt) {
        input.onBeforeAttempt(retryState.attempt, request.meta)
      }

      const dispatchLogData = {
        attempt: retryState.attempt,
        originalModel: request.meta.originalModel,
        provider: request.meta.provider,
        model: request.meta.model,
        endpoint: request.endpoint.slice(0, 100),
      }

      if (retryState.attempt === 1) {
        logger.info(dispatchLogData, 'Dispatching upstream request')
      } else {
        logger.debug(dispatchLogData, 'Dispatching upstream request')
      }

      // Decide per-request timeout; fall back to per-mode defaults
      const timeoutMs = input.timeoutMs ?? (mode === 'streaming' ? 60_000 : 30_000)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const init: RequestInit = {
          ...request.init,
          signal: controller.signal,
          // non-streaming keep-alive; Bun already reuses connections but this
          // makes the intent explicit and aligns with the spec
          ...(mode === 'non-streaming' ? { keepalive: true } : {}),
        }

        lastResponse = await fetch(request.endpoint, init)
      } finally {
        clearTimeout(timeoutId)
      }

      logger.debug(
        {
          attempt: retryState.attempt,
          status: lastResponse.status,
          contentLength: lastResponse.headers.get('content-length'),
        },
        'Upstream response received'
      )

      if (!lastResponse.ok) {
        const errorText = await lastResponse
          .clone()
          .text()
          .catch(() => '')

        // Log error details for debugging 403/4xx errors
        if (lastResponse.status === 403 || lastResponse.status === 400) {
          logger.warn(
            {
              reqId,
              status: lastResponse.status,
              provider: request.meta.provider,
              model: request.meta.model,
              endpoint: request.endpoint,
              errorPreview: errorText.slice(0, 500),
            },
            'Upstream error details'
          )
        }
        const retryAfterMs = parseRetryAfterMs(lastResponse, errorText)

        const result = await handleUpstreamError({
          reqId,
          provider: request.meta.provider,
          model: request.meta.model,
          originalModel: request.meta.originalModel,
          status: lastResponse.status,
          errorText,
          retryState,
          currentProjectId: request.meta.currentProjectId,
          router: options.router,
          retryAfterMs,
          apiKey: options.apiKey,
        })

        if (result.action === 'retry') {
          if (result.delay) {
            const delay = process.env.NODE_ENV === 'test' ? 1 : result.delay
            await new Promise((r) => setTimeout(r, delay))
          }
          continue
        }

        if (result.action === 'all-cooldown') {
          // Return 429 response directly
          let errorMessage =
            'All available models and providers are currently rate-limited. Please try again later.'
          if (result.reason) {
            const errorInfo = parseUpstreamError(result.reason, 429)
            errorMessage = errorInfo.message
          }

          return {
            response: new Response(
              JSON.stringify({
                error: {
                  message: errorMessage,
                  type: 'rate_limit_error',
                  code: 'all_providers_cooldown',
                },
              }),
              {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
              }
            ),
            meta: request.meta,
            retryState,
          }
        }

        if (result.action === 'switch-model') {
          // Update options for next iteration with new provider/model
          if (result.newProvider) {
            options.targetProvider = result.newProvider
          } else {
            delete options.targetProvider
          }

          if (result.newModel) {
            options.targetModel = result.newModel
          } else {
            delete options.targetModel
          }

          // Reset specific retry indices for new provider/model, but keep total attempts
          retryState.accountIndex = -1
          retryState.antigravityEndpointIndex = 0

          logger.info(
            {
              reqId,
              newProvider: result.newProvider,
              newModel: result.newModel,
              totalAttempts: retryState.attempt,
            },
            'Switching to fallback provider/model'
          )

          continue
        }

        if (result.action === 'throw') {
          throw new NonRetriableError(errorText, lastResponse.status, request.meta.provider)
        }
      }

      // Success
      if (options.router?.handleSuccess) {
        options.router.handleSuccess(request.meta.provider, request.meta.model)
      }

      // Log response to SQLite (non-streaming only, streaming logs separately)
      if (mode === 'non-streaming') {
        try {
          const responseClone = lastResponse.clone()
          const responseText = await responseClone.text()
          let preTransformResponse: unknown
          try {
            preTransformResponse = JSON.parse(responseText)
          } catch {
            preTransformResponse = { _raw: responseText }
          }

          const durationMs = Date.now() - startTime
          const logStore = getRequestLogStore()

          logStore.logResponse({
            requestId: reqId,
            preTransformResponse,
            postTransformResponse: null, // Initial log only has upstream response
            statusCode: lastResponse.status,
            durationMs, // Interim duration
          })
        } catch (logErr) {
          logger.warn({ reqId, error: String(logErr) }, 'Failed to log response to SQLite')
        }
      }

      if (input.onSuccessfulAttempt) {
        input.onSuccessfulAttempt(request.meta, lastResponse)
      }

      return {
        response: lastResponse,
        meta: request.meta,
        retryState,
      }
    } catch (error) {
      if (error instanceof NonRetriableError) {
        throw error
      }

      if (error instanceof AllCooldownError) {
        if (options.router && error.model && shouldContinueRetry(retryState)) {
          logger.warn(
            { reqId, provider: error.provider, model: error.model, attempt: retryState.attempt },
            'Current choice in cooldown (all accounts limited), triggering router fallback'
          )

          // Notify router to avoid immediate retry of the same model
          options.router.handleRateLimit(error.model)

          // CRITICAL: Clear explicit targets so router can re-resolve available alternatives on next loop
          delete options.targetProvider
          delete options.targetModel

          // Reset specific retry indices for fallback attempt
          retryState.accountIndex = -1
          retryState.antigravityEndpointIndex = 0

          // Safety: Add a small delay to prevent infinite spin loops
          const delay = process.env.NODE_ENV === 'test' ? 1 : 100
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        return {
          response: new Response(
            JSON.stringify({
              error: {
                message: error.message,
                type: 'rate_limit_error',
                code: 'all_providers_cooldown',
              },
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
          meta: lastMeta,
          retryState,
        }
      }

      const message = error instanceof Error ? error.message : String(error)
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' || message.toLowerCase().includes('aborted'))

      logger.error(
        { error: message, attempt: retryState.attempt, isTimeout: isAbortError },
        'Upstream fetch/network error'
      )

      // Provider-specific network error handling (e.g. Antigravity rotation)
      if (request?.meta?.provider) {
        const strategy = getProviderStrategy(request.meta.provider)
        if (strategy?.handleNetworkError) {
          const strategyResult = await strategy.handleNetworkError(
            error instanceof Error ? error : new Error(message),
            retryState
          )
          if (strategyResult) {
            if (strategyResult.action === 'retry') {
              if (strategyResult.delay) {
                await new Promise((r) => setTimeout(r, strategyResult.delay))
              }
              continue
            }
            // Handle other actions if needed, for now mostly retry
          }
        }
      }

      const isTest = process.env.NODE_ENV === 'test'

      const baseDelayMs = input.networkErrorBaseDelayMs ?? 100
      const maxDelayMs = input.networkErrorMaxDelayMs ?? 1000

      // attempt starts at 1, so exponent index is attempt - 1
      const attemptIndex = Math.max(retryState.attempt - 1, 0)
      const delay = isTest ? 1 : Math.min(baseDelayMs * 2 ** attemptIndex, maxDelayMs)

      await new Promise((r) => setTimeout(r, delay))
    }
  }

  if (lastResponse) {
    return {
      response: lastResponse,
      meta: lastMeta,
      retryState,
    }
  }

  throw new Error('Unexpected end of retry loop')
}
