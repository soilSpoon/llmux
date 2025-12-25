import { AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import { type ProviderName, transformRequest } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider: string
  targetModel?: string
  apiKey?: string
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini:
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent',
  antigravity: 'https://api.antigravity.ai/v1/streamGenerateContent',
}

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
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
    case 'antigravity':
      headers.Authorization = `Bearer ${apiKey}`
      break
  }

  return headers
}

interface StreamChunkData {
  text?: string
  delta?: { content?: string; role?: string }
  finish_reason?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): string {
  if (fromProvider === toFormat) return chunk

  try {
    const lines = chunk.split('\n').filter((line) => line.startsWith('data: '))
    const transformedLines: string[] = []

    for (const line of lines) {
      const jsonStr = line.slice(6).trim()
      if (jsonStr === '[DONE]') {
        transformedLines.push('data: [DONE]')
        continue
      }

      if (!jsonStr) continue

      const data = JSON.parse(jsonStr) as StreamChunkData
      const transformed = transformChunkData(data, fromProvider, toFormat)
      transformedLines.push(`data: ${JSON.stringify(transformed)}`)
    }

    return `${transformedLines.join('\n')}\n`
  } catch {
    return chunk
  }
}

function transformChunkData(
  data: StreamChunkData,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): Record<string, unknown> {
  let text = ''
  const finishReason = data.finish_reason

  if (fromProvider === 'anthropic') {
    if (data.delta?.content) text = data.delta.content
    if (data.delta?.role === 'assistant' && !text) text = ''
  } else if (fromProvider === 'openai') {
    const choice = (data as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]
    if (choice?.delta?.content) text = choice.delta.content
  } else if (fromProvider === 'gemini') {
    const candidates = (
      data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    ).candidates
    if (candidates?.[0]?.content?.parts?.[0]?.text) {
      text = candidates[0].content.parts[0].text
    }
  }

  if (toFormat === 'openai') {
    return {
      id: 'chatcmpl-streaming',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'proxy',
      choices: [
        {
          index: 0,
          delta: text ? { content: text } : {},
          finish_reason: finishReason ?? null,
        },
      ],
    }
  }

  if (toFormat === 'anthropic') {
    if (text) {
      return {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      }
    }
    if (finishReason) {
      return {
        type: 'message_delta',
        delta: { stop_reason: finishReason === 'stop' ? 'end_turn' : finishReason },
      }
    }
    return { type: 'ping' }
  }

  if (toFormat === 'gemini') {
    return {
      candidates: [
        {
          content: {
            parts: [{ text }],
            role: 'model',
          },
          finishReason: finishReason?.toUpperCase() ?? undefined,
        },
      ],
    }
  }

  return data as Record<string, unknown>
}

export async function handleStreamingProxy(
  request: Request,
  options: ProxyOptions
): Promise<Response> {
  try {
    const body = await request.json()

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: options.targetProvider as ProviderName,
    })

    if (options.targetModel) {
      ;(transformedRequest as { model?: string }).model = options.targetModel
    }
    ;(transformedRequest as { stream?: boolean }).stream = true

    const authProvider = AuthProviderRegistry.get(options.targetProvider)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && !options.apiKey) {
      endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro')

      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      try {
        credentials = await TokenRefresh.ensureFresh(options.targetProvider)
      } catch {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${options.targetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const credential = credentials[0]
      if (!credential) {
        return new Response(
          JSON.stringify({ error: `No credentials found for ${options.targetProvider}` }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      headers = await authProvider.getHeaders(credential)
    } else {
      const url = PROVIDER_ENDPOINTS[options.targetProvider]
      if (!url) {
        return new Response(
          JSON.stringify({ error: `Unknown provider: ${options.targetProvider}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      endpoint = url
      headers = buildHeaders(options.targetProvider, options.apiKey)
    }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(transformedRequest),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!upstreamResponse.ok) {
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!upstreamResponse.body) {
      return new Response(JSON.stringify({ error: 'No response body' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const targetProvider = options.targetProvider as ProviderName
    const sourceFormat = options.sourceFormat
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        if (targetProvider !== sourceFormat) {
          const transformed = transformStreamChunk(text, targetProvider, sourceFormat)
          controller.enqueue(encoder.encode(transformed))
        } else {
          controller.enqueue(chunk)
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
