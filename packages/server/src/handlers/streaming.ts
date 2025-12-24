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
      headers['Authorization'] = `Bearer ${apiKey}`
      break
    case 'gemini':
      headers['x-goog-api-key'] = apiKey
      break
    case 'antigravity':
      headers['Authorization'] = `Bearer ${apiKey}`
      break
  }

  return headers
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

    const endpoint = PROVIDER_ENDPOINTS[options.targetProvider]
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: `Unknown provider: ${options.targetProvider}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const headers = buildHeaders(options.targetProvider, options.apiKey)

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

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)
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
