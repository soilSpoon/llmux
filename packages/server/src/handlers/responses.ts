import { AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import {
  type ChatCompletionsResponse,
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
import type { AmpModelMapping } from '../config'
import { applyModelMapping } from './model-mapping'
import { transformStreamChunk } from './streaming'

export interface ResponsesOptions {
  targetProvider?: string
  targetModel?: string
  apiKey?: string
  modelMappings?: AmpModelMapping[]
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
}

function buildHeaders(targetProvider: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (!apiKey) return headers

  switch (targetProvider) {
    case 'anthropic':
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      break
    case 'openai':
      headers.Authorization = `Bearer ${apiKey}`
      break
    case 'gemini':
      headers['x-goog-api-key'] = apiKey
      break
  }

  return headers
}

function formatSSEEvent(event: ResponsesStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export async function handleResponses(
  request: Request,
  options: ResponsesOptions
): Promise<Response> {
  const targetProvider = options.targetProvider ?? 'openai'

  try {
    const body = (await request.json()) as ResponsesRequest
    const isStreaming = body.stream === true

    const chatRequest = transformResponsesRequest(body)

    if (body.model) {
      chatRequest.model = applyModelMapping(body.model, options.modelMappings)
    }

    if (options.targetModel) {
      chatRequest.model = options.targetModel
    }

    const authProvider = AuthProviderRegistry.get(targetProvider)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && !options.apiKey) {
      endpoint = authProvider.getEndpoint(options.targetModel || chatRequest.model)

      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      try {
        credentials = await TokenRefresh.ensureFresh(targetProvider)
      } catch {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${targetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const credential = credentials[0]
      if (!credential) {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${targetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      headers = await authProvider.getHeaders(credential)
    } else {
      const url = PROVIDER_ENDPOINTS[targetProvider]
      if (!url) {
        return new Response(JSON.stringify({ error: `Unknown provider: ${targetProvider}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      endpoint = url
      headers = buildHeaders(targetProvider, options.apiKey)
    }

    let upstreamRequest: unknown
    if (targetProvider === 'openai') {
      upstreamRequest = { ...chatRequest, stream: isStreaming }
    } else {
      upstreamRequest = transformRequest(
        { ...chatRequest, stream: isStreaming },
        { from: 'openai', to: targetProvider as ProviderName }
      )
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

      const transformer = new ResponsesStreamTransformer(chatRequest.model)
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      const providerName = targetProvider as ProviderName

      const transformStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            const openaiLine = transformStreamChunk(trimmed + '\n', providerName, 'openai')
            const openaiLines = openaiLine.split('\n').filter((l) => l.trim())

            for (const oLine of openaiLines) {
              const parsed = parseSSELine(oLine.trim())
              if (parsed === 'DONE') {
                const finalEvents = transformer.finish()
                for (const event of finalEvents) {
                  controller.enqueue(encoder.encode(formatSSEEvent(event)))
                }
                continue
              }

              if (parsed !== null) {
                const events = transformer.transformChunk(parsed)
                for (const event of events) {
                  controller.enqueue(encoder.encode(formatSSEEvent(event)))
                }
              }
            }
          }
        },
        flush(controller) {
          if (buffer.trim()) {
            const openaiLine = transformStreamChunk(buffer.trim() + '\n', providerName, 'openai')
            const openaiLines = openaiLine.split('\n').filter((l) => l.trim())

            for (const oLine of openaiLines) {
              const parsed = parseSSELine(oLine.trim())
              if (parsed !== null && parsed !== 'DONE') {
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
      const upstreamBody = await upstreamResponse.json()

      let openaiResponse: ChatCompletionsResponse
      if (targetProvider === 'openai') {
        openaiResponse = upstreamBody as ChatCompletionsResponse
      } else {
        openaiResponse = transformResponse(upstreamBody, {
          from: targetProvider as ProviderName,
          to: 'openai',
        }) as ChatCompletionsResponse
      }

      const responsesResponse = transformToResponsesResponse(openaiResponse)

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
