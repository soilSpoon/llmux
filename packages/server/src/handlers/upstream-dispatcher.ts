import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from '@llmux/auth'
import { createLogger } from '@llmux/core'
import type { SignatureStore } from '../stores'
import { parseRetryAfterMs } from '../upstream'
import { parseUpstreamError, type UpstreamErrorInfo } from './error-utils'
import {
  createRetryState,
  handleUpstreamError,
  incrementAttempt,
  type RetryState,
  rotateAntigravityEndpoint,
  shouldContinueRetry,
} from './request-handler'
import type { ProxyOptions } from './types'
import type {
  RequestBuilderInput,
  RequestBuilderResult,
  UpstreamRequestMeta,
} from './upstream-request-builder'

const logger = createLogger({ service: 'upstream-dispatcher' })

// Re-export for convenience
export type { UpstreamRequestMeta } from './upstream-request-builder'

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
  mode: 'streaming' | 'non-streaming'
  signatureStore: SignatureStore
  onBeforeAttempt?: (attempt: number, meta: UpstreamRequestMeta) => void
  onSuccessfulAttempt?: (meta: UpstreamRequestMeta, response: Response) => void
}

export interface DispatchResult {
  response: Response | null
  meta: UpstreamRequestMeta | null
  retryState: RetryState
  error?: Error
}

export async function dispatchWithRetry(input: DispatchInput): Promise<DispatchResult> {
  const { reqId, builder, initialBody, options, mode, signatureStore } = input

  const retryState = createRetryState()
  let lastResponse: Response | undefined
  let lastMeta: UpstreamRequestMeta | null = null

  while (shouldContinueRetry(retryState)) {
    incrementAttempt(retryState)

    const requestResult = await builder({
      reqId,
      body: initialBody as Record<string, unknown>, // Assuming object for now
      options,
      retryState,
      mode,
      signatureStore,
    })

    const { request } = requestResult
    lastMeta = request.meta

    // Update retry state in case builder mutated it (e.g. rotation)
    // Actually builder might modify retryState object reference or props

    if (input.onBeforeAttempt) {
      input.onBeforeAttempt(retryState.attempt, request.meta)
    }

    try {
      logger.debug(
        {
          attempt: retryState.attempt,
          provider: request.meta.provider,
          model: request.meta.model,
          endpoint: request.endpoint.slice(0, 100),
        },
        'Dispatching upstream request'
      )

      lastResponse = await fetch(request.endpoint, request.init)

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
        const retryAfterMs = parseRetryAfterMs(lastResponse, errorText) || 30000

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
        })

        if (result.action === 'retry') {
          if (result.delay) await new Promise((r) => setTimeout(r, result.delay))
          continue
        }

        if (result.action === 'all-cooldown') {
          // Return 429 response directly
          return {
            response: new Response(
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
            ),
            meta: request.meta,
            retryState,
          }
        }

        if (result.action === 'switch-model') {
          // Update options for next iteration with new provider/model
          if (result.newProvider) {
            options.targetProvider = result.newProvider
          }
          if (result.newModel) {
            options.targetModel = result.newModel
          }

          // Reset retry state for new provider/model
          retryState.accountIndex = 0
          retryState.antigravityEndpointIndex = 0
          retryState.attempt = 0

          logger.info(
            {
              reqId,
              newProvider: result.newProvider,
              newModel: result.newModel,
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

      // === DEBUG: non-streaming 응답 로깅 ===
      if (mode === 'non-streaming') {
        try {
          const fs = await import('node:fs')
          const debugDir = '/tmp/llmux-debug'
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

          if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true })
          }

          // 응답 클론해서 본문 읽기
          const responseClone = lastResponse.clone()
          const responseText = await responseClone.text()
          let responseBody: unknown
          try {
            responseBody = JSON.parse(responseText)
          } catch {
            responseBody = { _raw: responseText }
          }

          const responsePath = `${debugDir}/${timestamp}-${reqId}-3-response.json`
          fs.writeFileSync(
            responsePath,
            JSON.stringify(
              {
                _meta: {
                  reqId,
                  provider: request.meta.provider,
                  model: request.meta.model,
                  originalModel: request.meta.originalModel,
                  endpoint: request.endpoint,
                  status: lastResponse.status,
                  mode,
                  timestamp: new Date().toISOString(),
                },
                headers: Object.fromEntries(lastResponse.headers.entries()),
                body: responseBody,
              },
              null,
              2
            )
          )

          // 응답에서 contents 개수 요약
          const contentsCount =
            (responseBody as { candidates?: { content?: { parts?: unknown[] } }[] })
              ?.candidates?.[0]?.content?.parts?.length || 0

          logger.debug(
            {
              reqId,
              provider: request.meta.provider,
              model: request.meta.model,
              status: lastResponse.status,
              contentsCount,
              debugFile: responsePath,
            },
            '[DEBUG] Non-streaming response saved'
          )
        } catch (debugErr) {
          logger.warn(
            { reqId, error: String(debugErr) },
            '[DEBUG] Failed to write response debug file'
          )
        }
      }
      // === END DEBUG ===

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

      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error: message, attempt: retryState.attempt }, 'Upstream fetch/network error')

      // Antigravity specific rotation on network error
      if (request.meta.provider === 'antigravity') {
        rotateAntigravityEndpoint(retryState)
        if (retryState.antigravityEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
      }

      await new Promise((r) => setTimeout(r, 1000))
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
