import {
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_HEADERS,
  AuthProviderRegistry,
  CredentialStorage,
  fetchAntigravityProjectID,
  isOAuthCredential,
  TokenRefresh,
} from '@llmux/auth'
import { getProvider, type ProviderName, transformRequest } from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import { applyModelMapping } from './model-mapping'

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
  gemini:
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent',
  // Antigravity endpoint is handled dynamically, but providing a default here for fallback
  antigravity: `${ANTIGRAVITY_ENDPOINT_DAILY}${ANTIGRAVITY_API_PATH_STREAM}`,
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
      Object.assign(headers, ANTIGRAVITY_HEADERS)
      break
  }

  return headers
}

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): string {
  if (fromProvider === toFormat) return chunk

  // Handle [DONE] message specially for OpenAI compatibility
  if (chunk.trim() === 'data: [DONE]') {
    return chunk
  }

  // Handle empty or whitespace-only chunks
  if (!chunk.trim()) {
    // If it's just newlines, the test expects a single newline
    return chunk === '\n\n' ? '\n' : chunk
  }

  try {
    const sourceProvider = getProvider(fromProvider)
    const targetProvider = getProvider(toFormat as ProviderName)

    if (!sourceProvider.parseStreamChunk || !targetProvider.transformStreamChunk) {
      console.error(
        `[transformStreamChunk] Missing methods: source=${!!sourceProvider.parseStreamChunk} target=${!!targetProvider.transformStreamChunk}`
      )
      return chunk
    }

    const unified = sourceProvider.parseStreamChunk(chunk)
    if (!unified || unified.type === 'error') {
      console.error(`[transformStreamChunk] parseStreamChunk failed or returned error type`)
      return chunk
    }

    const result = targetProvider.transformStreamChunk(unified)
    console.error(
      `[transformStreamChunk] Success: ${fromProvider}→${toFormat}: ${result.slice(0, 80)}`
    )
    return result
  } catch (error) {
    // Return original chunk on error to avoid breaking the stream
    console.error(
      `[transformStreamChunk] Exception: ${error instanceof Error ? error.message : error}`
    )
    return chunk
  }
}

export async function handleStreamingProxy(
  request: Request,
  options: ProxyOptions
): Promise<Response> {
  try {
    const body = (await request.json()) as { model?: string }
    const originalModel = body.model

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: options.targetProvider as ProviderName,
    }) as { model?: string; stream?: boolean }

    if (originalModel) {
      transformedRequest.model = applyModelMapping(originalModel, options.modelMappings)
    }

    if (options.targetModel) {
      transformedRequest.model = options.targetModel
    }
    transformedRequest.stream = true

    const authProvider = AuthProviderRegistry.get(options.targetProvider)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && (!options.apiKey || options.apiKey === 'dummy')) {
      endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro')

      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      try {
        credentials = await TokenRefresh.ensureFresh(options.targetProvider)
      } catch {
        return new Response(
          JSON.stringify({
            error: `No credentials found for ${options.targetProvider}`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const credential = credentials[0]
      if (!credential) {
        return new Response(
          JSON.stringify({
            error: `No credentials found for ${options.targetProvider}`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      headers = await authProvider.getHeaders(credential)

      // Inject Project ID for Antigravity if available from OAuth credential
      if (options.targetProvider === 'antigravity' && isOAuthCredential(credential)) {
        if (credential.projectId) {
          ;(transformedRequest as any).project = credential.projectId
        } else {
          // Self-healing: credentials from older versions might miss projectId.
          // Fetch it now and update storage.
          try {
            const pid = await fetchAntigravityProjectID(credential.accessToken)
            if (pid) {
              credential.projectId = pid
              await CredentialStorage.update(options.targetProvider, credential)
              ;(transformedRequest as any).project = pid
            } else {
              // Fallback to default project ID if discovery fails (matches opencode behavior)
              credential.projectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
              await CredentialStorage.update(options.targetProvider, credential)
              ;(transformedRequest as any).project = ANTIGRAVITY_DEFAULT_PROJECT_ID
            }
          } catch (e) {
            console.warn(
              'Failed to recover Antigravity Project ID for credential, using default',
              e
            )
            ;(transformedRequest as any).project = ANTIGRAVITY_DEFAULT_PROJECT_ID
          }
        }
      }
    } else {
      const url = PROVIDER_ENDPOINTS[options.targetProvider]
      if (!url) {
        return new Response(
          JSON.stringify({
            error: `Unknown provider: ${options.targetProvider}`,
          }),
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
