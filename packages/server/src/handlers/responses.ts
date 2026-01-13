import { ANTIGRAVITY_API_PATH_STREAM, AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import {
  type ChatCompletionsResponse,
  createLogger,
  formatIdToProviderName,
  type ProviderName,
  type ResponsesRequest,
  transformRequest,
  transformResponse,
  transformResponsesRequest,
  transformToResponsesResponse,
} from '@llmux/core'
import type { CredentialProvider } from '../auth'
import type { ModelMapping } from '../config'
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
  modelMappings?: ModelMapping[]
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

      if (
        isStreaming &&
        (resolvedTargetProvider === 'antigravity' || resolvedTargetProvider === 'gemini-cli')
      ) {
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
      const messages = body.input || body.messages || []
      upstreamRequest = await buildCodexBody({
        model: body.model || 'gpt-5.1',
        messages,
        tools: body.tools,
        reasoning: body.reasoning,
        systemInstructions: body.instructions,
      })
    } else {
      upstreamRequest = transformRequest(
        { ...chatRequest, stream: isStreaming },
        {
          from: formatIdToProviderName('openai-chat'),
          to: resolvedTargetProvider as ProviderName,
          model: chatRequest.model,
        }
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

    // Capture upstream headers
    const responseHeaders = new Headers()

    // Forward critical headers from upstream (allowlist)
    const ALLOWED_HEADERS = [
      'x-request-id',
      'x-trace-id',
      'x-amp-request-id',
      // OpenAI Web specific headers
      'x-codex-plan-type',
      'x-codex-primary-used-percent',
      'x-codex-secondary-used-percent',
      'x-models-etag',
      'x-oai-request-id',
      // Wildcard prefix matching logic needed for some?
    ]

    // Explicitly add wildcard patterns manually
    const ALLOWED_PREFIXES = ['x-codex-', 'x-oai-']

    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (
        ALLOWED_HEADERS.includes(lowerKey) ||
        ALLOWED_PREFIXES.some((prefix) => lowerKey.startsWith(prefix))
      ) {
        responseHeaders.set(key, value)
      }
    })

    if (!upstreamResponse.ok) {
      if (isRateLimited(upstreamResponse) && fallbackProvider) {
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
          headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
        })
      }
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
      })
    }

    if (isStreaming) {
      if (!upstreamResponse.body) {
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
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
          ...Object.fromEntries(responseHeaders),
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    let upstreamBody: unknown

    if (resolvedTargetProvider === 'openai-web') {
      if (!upstreamResponse.body) {
        throw new Error('No response body from OpenAI Web')
      }

      const reader = upstreamResponse.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullResponse: unknown = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value)

        const parts = buffer.split('\n\n')
        const lastPart = parts.pop()
        buffer = lastPart ?? ''

        for (const part of parts) {
          const message = part.trim()
          if (!message) continue

          let eventType = ''
          let data = ''

          const lines = message.split('\n')
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              data = line.slice(5).trim()
            }
          }

          if (eventType === 'response.completed' && data) {
            try {
              const parsed = JSON.parse(data)
              if (parsed.response) {
                fullResponse = parsed.response
              }
            } catch (_e) {
              logger.warn({ data }, '[responses] Failed to parse completion event')
            }
          }
        }
      }

      if (!fullResponse) {
        throw new Error('No completion event received from OpenAI Web')
      }

      return new Response(JSON.stringify(fullResponse), {
        status: 200,
        headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
      })
    }

    const text = await upstreamResponse.text()
    try {
      upstreamBody = JSON.parse(text)
    } catch {
      throw new Error('Failed to parse JSON response')
    }

    let openaiResponse: ChatCompletionsResponse
    if (resolvedTargetProvider === 'openai') {
      openaiResponse = upstreamBody as ChatCompletionsResponse
    } else {
      openaiResponse = transformResponse(upstreamBody, {
        from: resolvedTargetProvider as ProviderName,
        to: formatIdToProviderName('openai-chat'),
      }) as ChatCompletionsResponse
    }

    const responsesResponse = transformToResponsesResponse(openaiResponse)

    return new Response(JSON.stringify(responsesResponse), {
      status: 200,
      headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
