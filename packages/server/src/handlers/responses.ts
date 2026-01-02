import { ANTIGRAVITY_API_PATH_STREAM, AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import {
  type ChatCompletionsResponse,
  createLogger,
  type ProviderName,
  type ResponsesRequest,
  transformRequest,
  transformResponse,
  transformResponsesRequest,
  transformToResponsesResponse,
} from '@llmux/core'
import type { CredentialProvider } from '../auth'
import type { AmpModelMapping } from '../config'
import { buildCodexBody } from '../providers'
import type { Router } from '../routing'
import { buildUpstreamHeaders, getDefaultEndpoint, isRateLimited } from '../upstream'
import { applyModelMapping } from './model-mapping'
import { createResponsesStreamTransformer } from './responses-stream'

const logger = createLogger({ service: 'responses-handler' })

export interface ResponsesOptions {
  targetProvider?: string
  targetModel?: string
  apiKey?: string
  modelMappings?: AmpModelMapping[]
  credentialProvider?: CredentialProvider
  router?: Router
}

export async function handleResponses(
  request: Request,
  options: ResponsesOptions
): Promise<Response> {
  try {
    const body = (await request.json()) as ResponsesRequest
    const isStreaming = body.stream === true

    let resolvedTargetProvider = options.targetProvider ?? 'openai'
    let fallbackProvider: string | null = null

    if (body.model && !options.targetProvider && options.router) {
      const resolution = await options.router.resolveModel(body.model)
      resolvedTargetProvider = resolution.provider
      if (resolvedTargetProvider === 'openai-web') {
        fallbackProvider = 'openai'
      }
    }

    const chatRequest = transformResponsesRequest(body)

    if (body.model) {
      chatRequest.model = applyModelMapping(body.model, options.modelMappings)
    }

    if (options.targetModel) {
      chatRequest.model = options.targetModel
    }

    const authProviderId = resolvedTargetProvider
    const authProvider = AuthProviderRegistry.get(authProviderId)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && !options.apiKey) {
      endpoint = authProvider.getEndpoint(options.targetModel || chatRequest.model)

      if (isStreaming && resolvedTargetProvider === 'antigravity') {
        const baseUrl = endpoint.split('/v1internal')[0]
        endpoint = baseUrl + ANTIGRAVITY_API_PATH_STREAM
      }

      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      try {
        credentials = await TokenRefresh.ensureFresh(resolvedTargetProvider)
      } catch {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${resolvedTargetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const credential = credentials[0]
      if (!credential) {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${resolvedTargetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      headers = await authProvider.getHeaders(credential, {
        model: options.targetModel || chatRequest.model,
      })
    } else {
      const url = getDefaultEndpoint(resolvedTargetProvider, { streaming: isStreaming })
      if (!url) {
        return new Response(
          JSON.stringify({ error: `Unknown provider: ${resolvedTargetProvider}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      endpoint = url
      headers = buildUpstreamHeaders(resolvedTargetProvider, options.apiKey)
    }

    let upstreamRequest: unknown
    if (resolvedTargetProvider === 'openai') {
      upstreamRequest = { ...chatRequest, stream: isStreaming }
    } else if (resolvedTargetProvider === 'openai-web') {
      upstreamRequest = await buildCodexBody({
        model: body.model || 'gpt-5.1',
        messages: body.input,
        tools: body.tools,
        reasoning: body.reasoning,
        systemInstructions: body.instructions,
      })
    } else {
      upstreamRequest = transformRequest(
        { ...chatRequest, stream: isStreaming },
        { from: 'openai', to: resolvedTargetProvider as ProviderName, model: chatRequest.model }
      )

      if (
        resolvedTargetProvider === 'antigravity' &&
        typeof upstreamRequest === 'object' &&
        upstreamRequest !== null
      ) {
        const req = upstreamRequest as Record<string, unknown>
        req.model = chatRequest.model
        if (!options.apiKey) {
          req.project = 'rising-fact-p41fc'
        }
      }
    }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamRequest),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!upstreamResponse.ok) {
      if (isRateLimited(upstreamResponse) && fallbackProvider) {
        logger.info(
          { from: resolvedTargetProvider, to: fallbackProvider },
          '[handleResponses] Rate limited, retrying with fallback'
        )
        return handleResponses(
          new Request(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(body),
          }),
          { ...options, targetProvider: fallbackProvider }
        )
      }

      const contentType = upstreamResponse.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await upstreamResponse.text()
        return new Response(JSON.stringify({ error: text || 'Non-JSON response from upstream' }), {
          status: upstreamResponse.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (isStreaming) {
      if (!upstreamResponse.body) {
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const transformStream = createResponsesStreamTransformer(
        chatRequest.model,
        resolvedTargetProvider as ProviderName
      )

      upstreamResponse.body.pipeTo(transformStream.writable).catch(() => {})

      return new Response(transformStream.readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    let upstreamBody: unknown
    const text = await upstreamResponse.text()
    try {
      upstreamBody = JSON.parse(text)
    } catch {
      throw new Error('Failed to parse JSON response')
    }

    if (resolvedTargetProvider === 'openai-web') {
      return new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let openaiResponse: ChatCompletionsResponse
    if (resolvedTargetProvider === 'openai') {
      openaiResponse = upstreamBody as ChatCompletionsResponse
    } else {
      openaiResponse = transformResponse(upstreamBody, {
        from: resolvedTargetProvider as ProviderName,
        to: 'openai',
      }) as ChatCompletionsResponse
    }

    const responsesResponse = transformToResponsesResponse(openaiResponse)

    return new Response(JSON.stringify(responsesResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
