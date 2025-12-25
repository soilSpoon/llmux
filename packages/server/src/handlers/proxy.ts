import { AuthProviderRegistry } from '@llmux/auth'
import { type ProviderName, transformRequest, transformResponse } from '@llmux/core'
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
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
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
  }

  return headers
}

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  try {
    const body = await request.json()

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: options.targetProvider as ProviderName,
    })

    if (options.targetModel) {
      ;(transformedRequest as { model?: string }).model = options.targetModel
    }

    const authProvider = AuthProviderRegistry.get(options.targetProvider)

    // Retry loop for rotation
    const maxAttempts = 5
    let attempt = 0
    let lastResponse: Response | undefined

    while (attempt < maxAttempts) {
      attempt++

      let endpoint = ''
      let headers: Record<string, string> = {}

      if (authProvider && !options.apiKey) {
        endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro')
        const credential = await authProvider.getCredential()
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

      lastResponse = upstreamResponse

      if (upstreamResponse.status === 429) {
        if (authProvider && !options.apiKey && authProvider.rotate) {
          authProvider.rotate()
          continue
        }
      }

      break
    }

    if (!lastResponse) {
      return new Response(JSON.stringify({ error: 'Request failed' }), { status: 500 })
    }

    if (!lastResponse.ok) {
      return new Response(lastResponse.body, {
        status: lastResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const upstreamBody = await lastResponse.json()

    const transformedResponse = transformResponse(upstreamBody, {
      from: options.targetProvider as ProviderName,
      to: formatToProvider(options.sourceFormat),
    })

    return new Response(JSON.stringify(transformedResponse), {
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
