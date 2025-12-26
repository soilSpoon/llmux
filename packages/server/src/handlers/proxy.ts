import { AuthProviderRegistry, TokenRefresh } from '@llmux/auth'
import {
  createLogger,
  isValidProviderName,
  type ProviderName,
  transformRequest,
  transformResponse,
} from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import { applyModelMapping } from './model-mapping'

const logger = createLogger({ service: 'proxy-handler' })

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider: string
  targetModel?: string
  apiKey?: string
  modelMappings?: AmpModelMapping[]
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
}

function formatToProvider(format: RequestFormat): ProviderName {
  if (!isValidProviderName(format)) {
    throw new Error(`Invalid source format: ${format}`)
  }
  return format
}

function buildHeaders(targetProvider: ProviderName, apiKey?: string): Record<string, string> {
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

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  const targetProviderInput = options.targetProvider
  if (!isValidProviderName(targetProviderInput)) {
    return new Response(JSON.stringify({ error: `Invalid provider: ${targetProviderInput}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetProvider: ProviderName = targetProviderInput

  try {
    const body = (await request.json()) as { model?: string; stream?: boolean }
    const originalModel = body.model

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: targetProvider,
    }) as { model?: string }

    let mappedModel: string | undefined = originalModel

    if (originalModel) {
      const appliedMapping = applyModelMapping(originalModel, options.modelMappings)
      if (appliedMapping !== originalModel) {
        logger.info(
          {
            originalModel,
            mappedModel: appliedMapping,
            mappings:
              options.modelMappings?.map(
                (m) => `${m.from}->${Array.isArray(m.to) ? m.to.join(',') : m.to}`
              ) || [],
          },
          'Model mapping applied'
        )
      } else {
        logger.info(
          {
            originalModel,
            availableMappings: options.modelMappings?.map((m) => m.from) || [],
          },
          'No model mapping found, using original model'
        )
      }
      transformedRequest.model = appliedMapping
      mappedModel = appliedMapping
    }

    if (options.targetModel) {
      logger.info(
        { originalModel, targetModel: options.targetModel },
        'Target model override applied'
      )
      transformedRequest.model = options.targetModel
      mappedModel = options.targetModel
    }

    logger.info(
      {
        sourceFormat: options.sourceFormat,
        targetProvider,
        originalModel,
        finalModel: mappedModel,
        stream: body.stream ?? false,
      },
      'Proxy request'
    )

    const authProvider = AuthProviderRegistry.get(targetProvider)

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

        let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
        try {
          credentials = await TokenRefresh.ensureFresh(targetProvider)
        } catch {
          return new Response(
            JSON.stringify({
              error: `No credentials found for ${targetProvider}`,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }

        const credential = credentials[0]
        if (!credential) {
          return new Response(
            JSON.stringify({
              error: `No credentials found for ${targetProvider}`,
            }),
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
        const delay = Math.min(1000 * 2 ** (attempt - 1), 16000)
        await new Promise((r) => setTimeout(r, delay))
        if (authProvider && !options.apiKey && authProvider.rotate) {
          authProvider.rotate()
        }
        continue
      }

      break
    }

    if (!lastResponse) {
      return new Response(JSON.stringify({ error: 'Request failed' }), {
        status: 500,
      })
    }

    if (!lastResponse.ok) {
      const contentType = lastResponse.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await lastResponse.text()
        return new Response(JSON.stringify({ error: text || 'Non-JSON response from upstream' }), {
          status: lastResponse.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(lastResponse.body, {
        status: lastResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const contentType = lastResponse.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await lastResponse.text()
      return new Response(JSON.stringify({ error: text || 'Non-JSON response from upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const upstreamBody = await lastResponse.json()

    const transformedResponse = transformResponse(upstreamBody, {
      from: targetProvider,
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
