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
import {
  buildSignatureSessionKey,
  cacheSignatureFromChunk,
  ensureThinkingSignatures,
  extractConversationKey,
  shouldCacheSignatures,
  type UnifiedRequestBody,
} from './signature-integration'

const logger = createLogger({ service: 'streaming-handler' })

// Model Aliases for Antigravity API
// These models need to be translated to their internal names
const ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-computer-use-preview-10-2025': 'rev19-uic3-1p',
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
  'gemini-3-pro-preview': 'gemini-3-pro-high',
  'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
  'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
  'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking',
}

function applyAntigravityAlias(model: string): string {
  return ANTIGRAVITY_MODEL_ALIASES[model] || model
}

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
    case 'opencode-zen':
      headers.Authorization = `Bearer ${apiKey}`
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

    // Resolve effective provider for opencode-zen
    let effectiveTargetProvider = options.targetProvider as ProviderName
    if (options.targetProvider === 'opencode-zen' && originalModel) {
      if (originalModel === 'glm-4.7-free' || originalModel.includes('claude')) {
        effectiveTargetProvider = 'anthropic'
      } else if (
        originalModel.startsWith('gpt-5') ||
        originalModel === 'glm-4.6' ||
        originalModel.startsWith('qwen') ||
        originalModel.startsWith('kimi') ||
        originalModel.startsWith('grok') ||
        originalModel === 'big-pickle'
      ) {
        effectiveTargetProvider = 'openai'
      } else if (originalModel.startsWith('gemini')) {
        effectiveTargetProvider = 'gemini'
      }
    }

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: effectiveTargetProvider,
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
      } else {
        logger.info(
          {
            originalModel,
            availableMappings: options.modelMappings?.map((m) => m.from) || [],
          },
          'No model mapping found, using original model (streaming)'
        )
      }

      // Antigravity transform handles internal model aliases (e.g. gemini-claude -> claude)
      // Only overwrite requestBody.model if there's an explicit mapping or if not Antigravity
      if (options.targetProvider !== 'antigravity' || appliedMapping !== originalModel) {
        requestBody.model = appliedMapping
      }
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

    // Apply Antigravity model alias transformation
    // The API expects internal model names (e.g., "claude-opus-4-5-thinking" instead of "gemini-claude-opus-4-5-thinking")
    if (options.targetProvider === 'antigravity' && mappedModel) {
      const aliasedModel = applyAntigravityAlias(mappedModel)
      if (aliasedModel !== mappedModel) {
        logger.info({ originalModel: mappedModel, aliasedModel }, 'Antigravity model alias applied')
        requestBody.model = aliasedModel
        mappedModel = aliasedModel
      }
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
    if (effectiveTargetProvider === 'openai' || effectiveTargetProvider === 'anthropic') {
      requestBody.stream = true
    }
    // For other providers, don't set stream field - will be handled by URL parameters

    // Signature restoration for Claude thinking models in multi-turn conversations
    // This ensures thinking blocks have proper signatures for subsequent requests
    const shouldCacheSignaturesForModel = shouldCacheSignatures(mappedModel)
    let signatureSessionKey: string | undefined
    if (shouldCacheSignaturesForModel && options.targetProvider === 'antigravity') {
      const conversationKey = extractConversationKey(body)
      const projectKey = (requestBody as UnifiedRequestBody).project
      signatureSessionKey = buildSignatureSessionKey(mappedModel, conversationKey, projectKey)

      // Restore signatures to thinking blocks in the request
      ensureThinkingSignatures(requestBody, signatureSessionKey)

      logger.debug(
        { model: mappedModel, sessionKey: signatureSessionKey },
        'Enabled signature caching for Claude thinking model'
      )
    }

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

      // Inject Anthropic version for Opencode Zen Anthropic-compatible requests
      if (options.targetProvider === 'opencode-zen' && effectiveTargetProvider === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01'
        // Ensure x-api-key is present if Authorization is used, just in case
        if (!headers['x-api-key'] && credential && 'key' in credential) {
          headers['x-api-key'] = (credential as { key: string }).key
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

    // Debug: Log outgoing request details
    logger.debug(
      {
        endpoint,
        model: requestBody.model,
        project: (requestBody as UnifiedRequestBody).project,
        hasContents: !!(requestBody as UnifiedRequestBody).request?.contents,
        bodyPreview: JSON.stringify(requestBody).slice(0, 500),
      },
      'Sending request to upstream'
    )

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      logger.error({ error: message, endpoint }, 'Upstream fetch failed')
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Debug: Log response status
    logger.info(
      {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        contentType: upstreamResponse.headers.get('content-type'),
      },
      'Received upstream response'
    )

    if (!upstreamResponse.ok) {
      // Try to read error body for debugging
      let errorBody = ''
      try {
        errorBody = await upstreamResponse.clone().text()
        logger.error(
          { status: upstreamResponse.status, body: errorBody.slice(0, 1000) },
          'Upstream returned error'
        )
      } catch {
        // ignore
      }
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

    const sourceFormat = options.sourceFormat
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    // Decouple response parsing provider from request target provider
    // This handles hybrid cases like GLM-4.7-free on Opencode Zen which accepts Anthropic input but returns OpenAI chunks
    let parsingProvider = effectiveTargetProvider
    if (options.targetProvider === 'opencode-zen' && originalModel === 'glm-4.7-free') {
      parsingProvider = 'openai'
    }

    let buffer = ''
    let sentMessageStart = false
    // Block state for thinking/text block management
    let currentBlockIndex = 0
    let currentBlockType: 'thinking' | 'text' | null = null

    // Signature caching state for Claude thinking models
    const thoughtBuffer = new Map<number, string>()

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        logger.debug({ chunkSize: chunk.length }, '[streaming] Received chunk')
        const text = decoder.decode(chunk, { stream: true })
        logger.debug({ textPreview: text.slice(0, 200) }, '[streaming] Chunk content')
        buffer += text

        // Process complete SSE events
        // Standard SSE uses "\n\n" between events, but Antigravity uses "\n" for each line
        // For Antigravity, each "data: {...}" line is a complete event
        let rawEvents: string[]

        if (parsingProvider === 'antigravity' || parsingProvider === 'gemini') {
          // Antigravity/Gemini: split by newline, look for "data:" lines
          const lines = buffer.split('\n')
          rawEvents = []

          // If buffer doesn't end with newline, the last line might be incomplete
          const lastLineIncomplete = !text.endsWith('\n')

          // Process all complete lines (all except possibly the last one)
          const linesToProcess = lastLineIncomplete ? lines.slice(0, -1) : lines
          const remainingLine = lastLineIncomplete ? (lines[lines.length - 1] ?? '') : ''

          for (const line of linesToProcess) {
            if (line.startsWith('data:')) {
              rawEvents.push(line)
            }
            // Skip empty lines and non-data lines
          }

          // Keep incomplete line in buffer for next chunk
          buffer = remainingLine
        } else {
          // Standard SSE: split by double newline
          rawEvents = buffer.split('\n\n')

          // Keep the last incomplete line in buffer
          if (!buffer.endsWith('\n\n')) {
            buffer = rawEvents.pop() || ''
          } else {
            buffer = ''
          }
        }

        // Process all complete events
        logger.debug(
          {
            rawEventsCount: rawEvents.length,
            bufferEndsWithDoubleNewline: buffer.endsWith('\n\n'),
            parsingProvider,
            sourceFormat,
          },
          '[streaming] Processing events'
        )

        for (const rawEvent of rawEvents) {
          if (!rawEvent.trim()) continue

          // console.log(
          //   `[streaming] Raw event length: ${
          //     rawEvent.length
          //   }, content: ${JSON.stringify(rawEvent.slice(0, 200))}`
          // );

          const eventWithNewline = `${rawEvent}\n\n`

          // console.error(`[streaming] Event ${eventCount}: from=${targetProvider}, to=${sourceFormat}, chunk_len=${eventWithNewline.length}`)

          if (parsingProvider !== sourceFormat) {
            try {
              // For Anthropic format, we need to ensure message_start is sent first
              if (sourceFormat === 'anthropic' && !sentMessageStart) {
                sentMessageStart = true
                const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`

                // Send message_start only (content_block_start will be sent on first chunk)
                const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
                controller.enqueue(encoder.encode(messageStart))

                logger.debug('Sent message_start event')
              }

              // console.error(`[streaming]   Transforming chunk...`)
              // console.log(
              //   `[streaming] Transforming chunk from ${parsingProvider} to ${sourceFormat}`
              // );
              const transformed = transformStreamChunk(
                eventWithNewline,
                parsingProvider,
                sourceFormat
              )

              logger.debug(
                {
                  from: parsingProvider,
                  to: sourceFormat,
                  transformedType: Array.isArray(transformed) ? 'array' : 'string',
                  transformedLength: Array.isArray(transformed)
                    ? transformed.length
                    : transformed.length,
                  transformedPreview: Array.isArray(transformed)
                    ? transformed.slice(0, 2).map((t) => t.slice(0, 100))
                    : transformed.slice(0, 200),
                },
                '[streaming] Transformed chunk'
              )

              // Helper function to detect block type from transformed SSE output
              const detectBlockType = (sse: string): 'thinking' | 'text' | null => {
                if (
                  sse.includes('"type":"thinking_delta"') ||
                  sse.includes('"type":"signature_delta"')
                ) {
                  return 'thinking'
                }
                if (sse.includes('"type":"text_delta"')) {
                  return 'text'
                }
                return null
              }

              // Helper function to send content_block_start event
              const sendBlockStart = (blockType: 'thinking' | 'text', index: number) => {
                if (blockType === 'thinking') {
                  const event = `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`
                  controller.enqueue(encoder.encode(event))
                } else {
                  const event = `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`
                  controller.enqueue(encoder.encode(event))
                }
              }

              // Helper function to send content_block_stop event
              const sendBlockStop = (index: number) => {
                const event = `event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`
                controller.enqueue(encoder.encode(event))
              }

              // Process transformed chunks with block type tracking
              const processChunk = (chunk: string) => {
                if (!chunk.trim()) return

                const chunkBlockType = detectBlockType(chunk)

                // If we have a block type change or first block, handle it
                if (chunkBlockType && sourceFormat === 'anthropic') {
                  if (currentBlockType === null) {
                    // First content block
                    sendBlockStart(chunkBlockType, currentBlockIndex)
                    currentBlockType = chunkBlockType
                  } else if (chunkBlockType !== currentBlockType) {
                    // Block type changed - close current and open new
                    sendBlockStop(currentBlockIndex)
                    currentBlockIndex++
                    sendBlockStart(chunkBlockType, currentBlockIndex)
                    currentBlockType = chunkBlockType
                  }

                  // Cache signature from thinking chunks for multi-turn support
                  if (
                    shouldCacheSignaturesForModel &&
                    signatureSessionKey &&
                    chunkBlockType === 'thinking'
                  ) {
                    // Extract thinking data from SSE chunk
                    const thinkingMatch = chunk.match(/"thinking":"([^"]*)"/)?.[1]
                    const signatureMatch = chunk.match(/"signature":"([^"]*)"/)?.[1]
                    if (thinkingMatch || signatureMatch) {
                      cacheSignatureFromChunk(
                        signatureSessionKey,
                        {
                          thinking: {
                            text: thinkingMatch,
                            signature: signatureMatch,
                          },
                        },
                        thoughtBuffer,
                        currentBlockIndex
                      )
                    }
                  }

                  // Update the index in the transformed chunk to match current block index
                  const updatedChunk = chunk.replace(
                    /"index":\s*\d+/,
                    `"index":${currentBlockIndex}`
                  )
                  controller.enqueue(encoder.encode(updatedChunk))
                } else if (chunk.trim()) {
                  controller.enqueue(encoder.encode(chunk))
                }
              }

              if (Array.isArray(transformed)) {
                for (const t of transformed) {
                  processChunk(t)
                }
              } else {
                processChunk(transformed)
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

              if (parsingProvider !== sourceFormat) {
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
                  parsingProvider,
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
    logger.info('Starting stream pipe to transform')
    upstreamResponse.body.pipeTo(transformStream.writable).catch((error) => {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: typeof error,
          errorName: error instanceof Error ? error.name : undefined,
          errorStack: error instanceof Error ? error.stack : undefined,
          errorObject: error,
        },
        'Stream pipeTo error'
      )
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
