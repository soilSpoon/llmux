import { ANTIGRAVITY_API_PATH_STREAM, AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import {
  type ChatCompletionsResponse,
  createLogger,
  type ProviderName,
  parseSSELine,
  type ResponsesRequest,
  type ResponsesStreamEvent,
  ResponsesStreamTransformer,
  transformRequest,
  transformResponse,
  transformResponsesRequest,
  transformToResponsesResponse,
} from '@llmux/core'
import type { CredentialProvider } from '../auth'
import type { AmpModelMapping } from '../config'
import { buildUpstreamHeaders, getDefaultEndpoint } from '../upstream'
import { getCodexInstructions } from './codex'
import { applyModelMapping } from './model-mapping'
import {
  isOpenAIModel,
  isRateLimited,
  type OpenAIProviderType,
  resolveOpenAIProvider,
} from './openai-fallback'
import { transformStreamChunk } from './streaming'

const logger = createLogger({ service: 'responses-handler' })

export interface ResponsesOptions {
  targetProvider?: string
  targetModel?: string
  apiKey?: string
  modelMappings?: AmpModelMapping[]
  credentialProvider?: CredentialProvider
}

function buildHeaders(targetProvider: string, apiKey?: string): Record<string, string> {
  return buildUpstreamHeaders(targetProvider, apiKey)
}

function formatSSEEvent(event: ResponsesStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Detect provider for a model by querying the credential provider's model registry
 */
async function detectProviderFromModel(
  model: string,
  credentialProvider?: CredentialProvider
): Promise<string> {
  if (!credentialProvider) {
    return 'openai' // default fallback
  }

  try {
    const credentials = await credentialProvider.getAllCredentials()
    const providers = Object.keys(credentials)

    // Build tokens for model lookup
    const tokens: Record<string, string> = {}
    for (const provider of providers) {
      try {
        const token = await credentialProvider.getAccessToken(provider)
        if (token) {
          tokens[provider] = token
        }
      } catch {
        // Skip provider if token retrieval fails
      }
    }

    // Import model fetcher
    const { createFetcher } = await import('../models/fetchers')
    const { createModelRegistry } = await import('../models/registry')

    const registry = createModelRegistry()
    for (const provider of providers) {
      registry.registerFetcher(provider, createFetcher(provider, { cache: undefined }))
    }

    const models = await registry.getModels(providers as string[], tokens)
    const foundModel = models.find((m) => m.id === model || m.name === model)

    if (foundModel) {
      console.error(`[detectProviderFromModel] Found ${model} → ${foundModel.provider}`)
      return foundModel.provider
    }
  } catch (error) {
    console.error(`[detectProviderFromModel] Error looking up model:`, error)
  }

  // Fallback to OpenAI if not found
  return 'openai'
}

export async function handleResponses(
  request: Request,
  options: ResponsesOptions
): Promise<Response> {
  logger.debug('[handleResponses] CALLED')

  try {
    const body = (await request.json()) as ResponsesRequest
    logger.debug({ body: JSON.stringify(body).slice(0, 100) }, '[handleResponses] body received')
    const isStreaming = body.stream === true
    logger.debug({ isStreaming }, '[handleResponses] streaming mode')

    // Determine target provider with OpenAI fallback support
    let resolvedTargetProvider = options.targetProvider ?? 'openai'
    let fallbackProvider: OpenAIProviderType | null = null

    if (body.model && !options.targetProvider) {
      // For OpenAI-compatible models, use the smart fallback resolver
      if (isOpenAIModel(body.model)) {
        const resolved = await resolveOpenAIProvider()
        resolvedTargetProvider = resolved.primary
        fallbackProvider = resolved.fallback
        logger.info(
          { model: body.model, primary: resolvedTargetProvider, fallback: fallbackProvider },
          '[handleResponses] OpenAI provider resolved with fallback'
        )
      } else {
        // For non-OpenAI models, use the existing detection logic
        const detected = await detectProviderFromModel(body.model, options.credentialProvider)
        resolvedTargetProvider = detected
        logger.debug(
          { provider: resolvedTargetProvider },
          '[handleResponses] Detected provider from model'
        )
      }
    }

    const chatRequest = transformResponsesRequest(body)
    console.error('[handleResponses] transformResponsesRequest completed')

    if (body.model) {
      chatRequest.model = applyModelMapping(body.model, options.modelMappings)
    }

    if (options.targetModel) {
      chatRequest.model = options.targetModel
    }

    // Use the resolved provider directly (openai-web is a first-class provider)
    const authProviderId = resolvedTargetProvider
    const authProvider = AuthProviderRegistry.get(authProviderId)
    console.error('[handleResponses] authProvider found:', !!authProvider, 'for', authProviderId)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && !options.apiKey) {
      console.error('[handleResponses] Using authProvider path')
      endpoint = authProvider.getEndpoint(options.targetModel || chatRequest.model)

      // For streaming requests with Antigravity, use streaming endpoint
      if (isStreaming && resolvedTargetProvider === 'antigravity') {
        const baseUrl = endpoint.split('/v1internal')[0]
        endpoint = baseUrl + ANTIGRAVITY_API_PATH_STREAM
        console.error('[handleResponses] Antigravity streaming endpoint:', endpoint)
      } else {
        console.error('[handleResponses] endpoint:', endpoint)
      }

      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      try {
        // Use the resolved provider directly for credentials
        const credentialProviderId = resolvedTargetProvider
        credentials = await TokenRefresh.ensureFresh(credentialProviderId)
        console.error('[handleResponses] credentials acquired')
      } catch (e) {
        console.error('[handleResponses] credentials error:', e)
        return new Response(
          JSON.stringify({
            error: `No credentials found for ${resolvedTargetProvider}`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const credential = credentials[0]
      if (!credential) {
        return new Response(
          JSON.stringify({
            error: `No credentials found for ${resolvedTargetProvider}`,
          }),
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
          JSON.stringify({
            error: `Unknown provider: ${resolvedTargetProvider}`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
      endpoint = url
      headers = buildHeaders(resolvedTargetProvider, options.apiKey)
    }

    let upstreamRequest: unknown
    if (resolvedTargetProvider === 'openai') {
      upstreamRequest = { ...chatRequest, stream: isStreaming }
    } else if (resolvedTargetProvider === 'openai-web') {
      // openai-web uses Codex backend with specific requirements:
      // - store: false (ChatGPT backend requires stateless mode)
      // - stream: true (always stream, response handling converts if needed)
      // - instructions: required system prompt
      let instructions = body.instructions
      if (!instructions) {
        // Fetch default instructions if not provided
        // body.model should be set for openai-web requests (e.g., 'gpt-5-codex', 'gpt-5.1')
        instructions = await getCodexInstructions(body.model || 'gpt-5.1')
      }
      const codexBody = {
        model: body.model,
        instructions,
        input: body.input,
        store: false,
        stream: true,
        // Pass through other optional fields if present
        ...(body.tools && { tools: body.tools }),
        ...(body.reasoning && { reasoning: body.reasoning }),
      }
      upstreamRequest = codexBody
      console.error(
        '[handleResponses] openai-web codex body:',
        JSON.stringify(codexBody).slice(0, 300)
      )
    } else {
      upstreamRequest = transformRequest(
        { ...chatRequest, stream: isStreaming },
        { from: 'openai', to: resolvedTargetProvider as ProviderName }
      )

      // For Antigravity, inject the model and project into the transformed request
      if (
        resolvedTargetProvider === 'antigravity' &&
        typeof upstreamRequest === 'object' &&
        upstreamRequest !== null
      ) {
        const req = upstreamRequest as Record<string, unknown>
        console.error(
          '[responses handler] Antigravity request before adjustment:',
          JSON.stringify(req).slice(0, 200)
        )
        req.model = chatRequest.model // Use the original model name, not the default
        if (!options.apiKey) {
          req.project = 'rising-fact-p41fc'
        }
        console.error(
          '[responses handler] Antigravity request after adjustment:',
          JSON.stringify(req).slice(0, 200)
        )
      }
    }

    let upstreamResponse: Response
    try {
      console.error('[handleResponses] Calling upstream endpoint')
      console.error('[handleResponses] endpoint:', endpoint)
      console.error(
        '[handleResponses] request body:',
        JSON.stringify(upstreamRequest).slice(0, 200)
      )
      upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamRequest),
      })
      console.error('[handleResponses] upstream response status:', upstreamResponse.status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      console.error('[handleResponses] upstream fetch error:', message)
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!upstreamResponse.ok) {
      logger.warn({ status: upstreamResponse.status }, '[handleResponses] upstream response NOT ok')

      // Handle 429 with fallback provider
      if (isRateLimited(upstreamResponse) && fallbackProvider) {
        logger.info(
          { from: resolvedTargetProvider, to: fallbackProvider },
          '[handleResponses] Rate limited, retrying with fallback provider'
        )
        // Recursively call with fallback provider
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
        logger.debug({ text: text.slice(0, 200) }, '[handleResponses] non-JSON response')
        return new Response(JSON.stringify({ error: text || 'Non-JSON response from upstream' }), {
          status: upstreamResponse.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      logger.debug(
        { status: upstreamResponse.status },
        '[handleResponses] returning upstream error as-is'
      )
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (isStreaming) {
      console.error('[handleResponses] STREAMING PATH - upstream response ok:', upstreamResponse.ok)
      if (!upstreamResponse.body) {
        console.error('[handleResponses] STREAMING - No response body!')
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      console.error('[handleResponses] STREAMING - Body available, starting transform...')

      const transformer = new ResponsesStreamTransformer(chatRequest.model)
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      // Detect upstream provider from response format (will be set on first chunk)
      let actualUpstreamProvider: ProviderName = resolvedTargetProvider as ProviderName
      let providerDetected = false

      const transformStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            console.error('[handleResponses STREAM] Input line:', trimmed.slice(0, 100))

            // Detect upstream provider from response format on first chunk
            if (!providerDetected) {
              providerDetected = true
              // Check if response looks like Antigravity format (has "response" and "candidates")
              if (trimmed.includes('"response"') && trimmed.includes('"candidates"')) {
                actualUpstreamProvider = 'antigravity'
                console.error('[handleResponses STREAM] Detected Antigravity format')
              } else if (trimmed.includes('"choices"')) {
                actualUpstreamProvider = 'openai'
                console.error('[handleResponses STREAM] Detected OpenAI format')
              }
            }

            // Transform from actual upstream provider to OpenAI SSE format
            const openaiSSE = transformStreamChunk(trimmed, actualUpstreamProvider, 'openai')
            console.error(
              '[handleResponses STREAM] After transform:',
              typeof openaiSSE === 'string' ? openaiSSE.slice(0, 100) : 'array'
            )

            // Handle both string and array results from transformStreamChunk
            const sseLines = Array.isArray(openaiSSE) ? openaiSSE : [openaiSSE]
            for (const sseLine of sseLines) {
              // Parse OpenAI SSE line to ChatCompletionChunk
              const parsed = parseSSELine(sseLine)
              console.error(
                '[handleResponses STREAM] Parsed:',
                parsed === 'DONE' ? '[DONE]' : parsed === null ? 'null' : 'ChatCompletionChunk'
              )

              if (parsed === 'DONE') {
                console.error('[handleResponses STREAM] Received [DONE]')
                const finalEvents = transformer.finish()
                for (const event of finalEvents) {
                  controller.enqueue(encoder.encode(formatSSEEvent(event)))
                }
                continue
              }

              if (parsed !== null && typeof parsed === 'object') {
                const events = transformer.transformChunk(parsed)
                console.error('[handleResponses STREAM] Generated', events.length, 'events')
                for (const event of events) {
                  const formatted = formatSSEEvent(event)
                  console.error('[handleResponses STREAM] Event:', event.type)
                  controller.enqueue(encoder.encode(formatted))
                }
              }
            }
          }
        },
        flush(controller) {
          if (buffer.trim()) {
            console.error('[handleResponses STREAM] Flush buffer:', buffer.trim().slice(0, 100))

            const openaiSSE = transformStreamChunk(buffer.trim(), actualUpstreamProvider, 'openai')
            const sseLines = Array.isArray(openaiSSE) ? openaiSSE : [openaiSSE]
            for (const sseLine of sseLines) {
              const parsed = parseSSELine(sseLine)

              if (parsed !== null && parsed !== 'DONE' && typeof parsed === 'object') {
                const events = transformer.transformChunk(parsed)
                for (const event of events) {
                  controller.enqueue(encoder.encode(formatSSEEvent(event)))
                }
              }
            }
          }
        },
      })

      upstreamResponse.body.pipeTo(transformStream.writable)

      return new Response(transformStream.readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } else {
      let upstreamBody: unknown
      const text = await upstreamResponse.text()
      try {
        upstreamBody = JSON.parse(text)
      } catch (e) {
        console.error('[handleResponses] Failed to parse JSON, raw response:', text.slice(0, 500))
        throw e
      }

      // openai-web returns responses API format directly, no transformation needed
      if (resolvedTargetProvider === 'openai-web') {
        console.error(
          '[handleResponses] openai-web response (passthrough):',
          JSON.stringify(upstreamBody).slice(0, 500)
        )
        return new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      let openaiResponse: ChatCompletionsResponse
      if (resolvedTargetProvider === 'openai') {
        openaiResponse = upstreamBody as ChatCompletionsResponse
      } else {
        console.error(
          '[handleResponses] Transforming response from',
          resolvedTargetProvider,
          ':',
          JSON.stringify(upstreamBody).slice(0, 300)
        )
        openaiResponse = transformResponse(upstreamBody, {
          from: resolvedTargetProvider as ProviderName,
          to: 'openai',
        }) as ChatCompletionsResponse
        console.error('[handleResponses] Transformed to OpenAI response')
      }

      const responsesResponse = transformToResponsesResponse(openaiResponse)
      console.error(
        '[handleResponses] Final responsesResponse:',
        JSON.stringify(responsesResponse).slice(0, 500)
      )

      return new Response(JSON.stringify(responsesResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
