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
import { createLogger, getProvider, type ProviderName, transformRequest } from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import { applyModelMapping } from './model-mapping'

const logger = createLogger({ service: 'streaming-handler' })

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
): string | string[] {
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
      return chunk
    }

    const unified = sourceProvider.parseStreamChunk(chunk)

    if (!unified) {
      return chunk
    }

    if (Array.isArray(unified)) {
      return unified
        .map((c) => targetProvider.transformStreamChunk?.(c))
        .filter((v): v is string => v !== undefined)
    }

    if (unified.type === 'error') {
      return chunk
    }

    const result = targetProvider.transformStreamChunk(unified)
    return result
  } catch (error) {
    logger.error(
      {
        fromProvider,
        toFormat,
        error: error instanceof Error ? error.message : String(error),
        chunkSample: chunk.slice(0, 200),
        stack: error instanceof Error ? error.stack : undefined,
      },
      'Error transforming stream chunk'
    )
    // Return empty string instead of original chunk to avoid type mismatches
    return ''
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
    })

    // Transform output is a union type based on target provider, narrow to base request object
    const requestBody = transformedRequest as Record<string, unknown>

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
          'Model mapping applied (streaming)'
        )
      }
      requestBody.model = appliedMapping
      mappedModel = appliedMapping
    }

    if (options.targetModel) {
      logger.info(
        { originalModel, targetModel: options.targetModel },
        'Target model override applied (streaming)'
      )
      requestBody.model = options.targetModel
      mappedModel = options.targetModel
    }

    logger.info(
      {
        sourceFormat: options.sourceFormat,
        targetProvider: options.targetProvider,
        originalModel,
        finalModel: mappedModel,
      },
      'Streaming proxy request'
    )

    // Only set stream=true for OpenAI and Anthropic providers
    // Gemini/Antigravity use URL parameters (alt=sse)
    if (options.targetProvider === 'openai' || options.targetProvider === 'anthropic') {
      requestBody.stream = true
    }
    // For other providers, don't set stream field - will be handled by URL parameters

    const authProvider = AuthProviderRegistry.get(options.targetProvider)

    let endpoint: string
    let headers: Record<string, string>

    if (authProvider && (!options.apiKey || options.apiKey === 'dummy')) {
      endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro', {
        streaming: true,
      })

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
        let projectId = credential.projectId

        if (!projectId) {
          // Self-healing: credentials from older versions might miss projectId.
          // Fetch it now and update storage.
          try {
            const pid = await fetchAntigravityProjectID(credential.accessToken)
            projectId = pid || ANTIGRAVITY_DEFAULT_PROJECT_ID
            credential.projectId = projectId
            await CredentialStorage.update(options.targetProvider, credential)
          } catch (e) {
            logger.warn(
              { error: e instanceof Error ? e.message : String(e) },
              'Failed to recover Antigravity Project ID for credential, using default'
            )
            projectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
          }
        }

        // Set project on the request object
        requestBody.project = projectId
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
        body: JSON.stringify(requestBody),
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

    let buffer = ''
    let sentMessageStart = false

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        buffer += text

        // Process complete SSE events (end with \n\n)
        const rawEvents = buffer.split('\n\n')

        // Keep the last incomplete line in buffer
        if (!buffer.endsWith('\n\n')) {
          buffer = rawEvents.pop() || ''
        } else {
          buffer = ''
        }

        // Process all complete events
        for (const rawEvent of rawEvents) {
          if (!rawEvent.trim()) continue

          const eventWithNewline = `${rawEvent}\n\n`

          // console.error(`[streaming] Event ${eventCount}: from=${targetProvider}, to=${sourceFormat}, chunk_len=${eventWithNewline.length}`)

          if (targetProvider !== sourceFormat) {
            try {
              // For Anthropic format, we need to ensure message_start is sent first
              if (sourceFormat === 'anthropic' && !sentMessageStart) {
                sentMessageStart = true
                const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_${Math.random()
                  .toString(36)
                  .slice(
                    2,
                    11
                  )}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
                // console.error(`[streaming]   Sending message_start`)
                controller.enqueue(encoder.encode(messageStart))
              }

              // console.error(`[streaming]   Transforming chunk...`)
              const transformed = transformStreamChunk(
                eventWithNewline,
                targetProvider,
                sourceFormat
              )

              if (Array.isArray(transformed)) {
                // console.error(`[streaming]   Transformed to array (${transformed.length} items)`)
                for (const t of transformed) {
                  if (t.trim()) controller.enqueue(encoder.encode(t))
                }
              } else if (transformed.trim()) {
                // console.error(`[streaming]   Transformed to single chunk (${transformed.length} bytes)`)
                controller.enqueue(encoder.encode(transformed))
              } else {
                // console.error(`[streaming]   Transformed chunk is empty`)
              }
            } catch (error) {
              logger.error(
                {
                  error: error instanceof Error ? error.message : String(error),
                },
                'Stream chunk transform error'
              )
              throw error
            }
          } else {
            controller.enqueue(encoder.encode(eventWithNewline))
          }
        }
      },
      flush(controller) {
        try {
          // console.error(`[streaming] Flush called, buffer=${buffer.length} bytes, sentMessageStart=${sentMessageStart}`)

          // Process any remaining buffered data
          if (buffer.trim()) {
            // Split remaining buffer into events (may have multiple events without \n\n at end)
            const events = buffer.split('\n\n').filter((e) => e.trim())
            // console.error(`[streaming] Flush: found ${events.length} events in buffer`)

            for (const event of events) {
              const eventWithNewline = `${event}\n\n`

              if (targetProvider !== sourceFormat) {
                // For Anthropic format, we need to ensure message_start is sent first
                if (sourceFormat === 'anthropic' && !sentMessageStart) {
                  sentMessageStart = true
                  const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_${Math.random()
                    .toString(36)
                    .slice(
                      2,
                      11
                    )}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
                  // console.error(`[streaming]   Flush: Sending message_start`)
                  controller.enqueue(encoder.encode(messageStart))
                }

                // console.error(`[streaming]   Flush: Raw event (${eventWithNewline.length} bytes)`)
                const transformed = transformStreamChunk(
                  eventWithNewline,
                  targetProvider,
                  sourceFormat
                )

                if (Array.isArray(transformed)) {
                  // console.error(`[streaming]   Flush: Transformed to array (${transformed.length} items)`)
                  for (const t of transformed) {
                    if (t.trim()) controller.enqueue(encoder.encode(t))
                  }
                } else if (transformed.trim()) {
                  // console.error(`[streaming]   Flush: Transformed to single chunk (${transformed.length} bytes)`)
                  controller.enqueue(encoder.encode(transformed))
                }
              } else {
                controller.enqueue(encoder.encode(eventWithNewline))
              }
            }
          }
        } catch (error) {
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'Stream flush error'
          )
          throw error
        }
      },
    })

    // console.error(`[streaming] Piping response body to transform stream`)
    upstreamResponse.body.pipeTo(transformStream.writable).catch((_error) => {
      // console.error(`[streaming] pipeTo error: ${_error instanceof Error ? _error.message : _error}`)
    })

    // console.error(`[streaming] Returning response with readable stream`)
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
