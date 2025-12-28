import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
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
import { normalizeBashArguments } from './bash-normalization'
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

import type { Router } from '../routing'

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider: string
  targetModel?: string
  apiKey?: string
  modelMappings?: AmpModelMapping[]
  router?: Router
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  antigravity:
    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
}

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

function buildHeaders(
  targetProvider: string,
  apiKey?: string,
  fromProtocol?: string
): Record<string, string> {
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
      if (fromProtocol === 'openai') {
        headers.Authorization = `Bearer ${apiKey}`
      } else {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      }
      break
  }

  return headers
}

/**
 * Apply Bash argument normalization to a StreamChunk.
 * This handles cases where Gemini returns `cmd` instead of `command` for Bash tool calls.
 */
function applyBashNormalizationToChunk(
  chunk: import('@llmux/core').StreamChunk
): import('@llmux/core').StreamChunk {
  // Only process tool_call chunks
  if (chunk.type !== 'tool_call' || !chunk.delta?.toolCall) {
    return chunk
  }

  const toolCall = chunk.delta.toolCall
  if (!toolCall.name || !toolCall.arguments || typeof toolCall.arguments !== 'object') {
    return chunk
  }

  // Apply normalization to the arguments
  const normalizedArgs = normalizeBashArguments(
    toolCall.name,
    toolCall.arguments as Record<string, unknown>
  )

  // If no change was made, return original chunk
  if (normalizedArgs === toolCall.arguments) {
    return chunk
  }

  // Log that normalization was applied
  logger.debug(
    {
      toolName: toolCall.name,
      originalArgs: toolCall.arguments,
      normalizedArgs,
    },
    '[streaming] Bash argument normalization applied'
  )

  // Return new chunk with normalized arguments
  return {
    ...chunk,
    delta: {
      ...chunk.delta,
      toolCall: {
        ...toolCall,
        arguments: normalizedArgs,
      },
    },
  }
}

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): string | string[] {
  console.error(
    `[DIAG] transformStreamChunk called from=${fromProvider} to=${toFormat} chunk=${chunk
      .trim()
      .slice(0, 50)}`
  )
  // Do not return early if the chunk is a raw JSON object, as it needs to be formatted as SSE
  if (fromProvider === toFormat && !chunk.trim().startsWith('{')) return chunk

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
      // If it's raw JSON that failed to parse into a valid event, filter it out
      if (chunk.trim().startsWith('{')) {
        return ''
      }
      return chunk
    }

    if (Array.isArray(unified)) {
      // Apply Bash normalization for Antigravity provider
      const normalized =
        fromProvider === 'antigravity'
          ? unified.map((c) => applyBashNormalizationToChunk(c))
          : unified
      return normalized
        .map((c) => targetProvider.transformStreamChunk?.(c))
        .filter((v): v is string => v !== undefined)
    }

    if (unified.type === 'error') {
      return chunk
    }

    // Apply Bash normalization for Antigravity provider
    const normalizedChunk =
      fromProvider === 'antigravity' ? applyBashNormalizationToChunk(unified) : unified

    const result = targetProvider.transformStreamChunk(normalizedChunk)
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
  logger.info(
    {
      targetProvider: options.targetProvider,
      targetModel: options.targetModel,
      apiKeyLength: options.apiKey?.length,
      isDummyKey: options.apiKey === 'dummy',
    },
    '[Streaming] Handling proxy request entry'
  )

  try {
    const body = (await request.json()) as { model?: string }
    const originalModel = body.model

    let initialMappedModel: string | undefined = originalModel

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
      initialMappedModel = appliedMapping
    }

    if (options.targetModel) {
      logger.info(
        { originalModel, targetModel: options.targetModel },
        'Target model override applied (streaming)'
      )
      initialMappedModel = options.targetModel
    }

    // Retry loop for rotation
    const maxAttempts = 5
    let attempt = 0
    let lastResponse: Response | undefined
    let currentProvider = options.targetProvider
    let currentModel = initialMappedModel

    // Variables hoisted for scope access after retry loop
    let effectiveTargetProvider: ProviderName = options.targetProvider as ProviderName // Default
    let requestBody: Record<string, unknown> = {}
    let endpoint: string = ''
    let headers: Record<string, string> = {}
    let shouldCacheSignaturesForModel: boolean = false
    let signatureSessionKey: string | undefined

    while (attempt < maxAttempts) {
      attempt++

      // Resolve effective provider for opencode-zen (re-evaluated in loop)
      effectiveTargetProvider = currentProvider as ProviderName
      if (currentProvider === 'opencode-zen' && currentModel) {
        if (currentModel.includes('claude')) {
          effectiveTargetProvider = 'anthropic'
        } else if (
          currentModel.startsWith('gpt-5') ||
          currentModel.startsWith('glm-') ||
          currentModel.startsWith('qwen') ||
          currentModel.startsWith('kimi') ||
          currentModel.startsWith('grok') ||
          currentModel === 'big-pickle'
        ) {
          effectiveTargetProvider = 'openai'
        } else if (currentModel.startsWith('gemini')) {
          effectiveTargetProvider = 'gemini'
        }
      }

      // Re-transform request if needed (provider or model change)
      const transformedRequest = transformRequest(body, {
        from: formatToProvider(options.sourceFormat),
        to: effectiveTargetProvider,
      })

      // Transform output is a union type based on target provider, narrow to base request object
      requestBody = transformedRequest as Record<string, unknown>

      if (currentModel) {
        // Antigravity transform handles internal model aliases
        // Only overwrite requestBody.model if there's an explicit mapping or if not Antigravity
        // Or if we have switched models via fallback
        if (currentProvider !== 'antigravity' || currentModel !== originalModel) {
          requestBody.model = currentModel
        }
      }

      // Apply Antigravity model alias transformation (re-applied in loop)
      if (currentProvider === 'antigravity' && currentModel) {
        const aliasedModel = applyAntigravityAlias(currentModel)
        if (aliasedModel !== currentModel) {
          requestBody.model = aliasedModel
        }
      }

      // Ensure stream flags are set correctly
      if (effectiveTargetProvider === 'openai' || effectiveTargetProvider === 'anthropic') {
        requestBody.stream = true
        if (effectiveTargetProvider === 'openai') {
          // Request usage info from OpenAI-compatible providers
          requestBody.stream_options = { include_usage: true }
        }
      }

      // Signature restoration (skip for brevity in retry loop unless critical? It handles signatures...)
      // We should probably keep signature caching logic.
      // But it depends on `mappedModel` which is now `currentModel`.
      shouldCacheSignaturesForModel = shouldCacheSignatures(currentModel || '')
      signatureSessionKey = undefined // Reset for this attempt
      if (shouldCacheSignaturesForModel && currentProvider === 'antigravity') {
        const conversationKey = extractConversationKey(body)
        const projectKey = (requestBody as UnifiedRequestBody).project
        signatureSessionKey = buildSignatureSessionKey(
          currentModel || '',
          conversationKey,
          projectKey
        )
        ensureThinkingSignatures(requestBody, signatureSessionKey)
      }

      const authProvider = AuthProviderRegistry.get(currentProvider)

      // Reset for this attempt (using hoisted variables)
      endpoint = ''
      headers = {}

      if (authProvider && (!options.apiKey || options.apiKey === 'dummy')) {
        // ... (Credential logic)
        try {
          endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro', {
            streaming: true,
          })
        } catch {
          // Fallback for providers that don't support getEndpoint with options or if it fails
          endpoint = ''
        }

        // Simplified credential retrieval for retry loop context
        let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
        try {
          credentials = await TokenRefresh.ensureFresh(currentProvider)
        } catch {
          // If failed, break or return 401
          return new Response(JSON.stringify({ error: `No credentials for ${currentProvider}` }), {
            status: 401,
          })
        }

        const credential = credentials?.[0]
        if (!credential)
          return new Response(JSON.stringify({ error: `No credentials` }), {
            status: 401,
          })

        headers = await authProvider.getHeaders(credential)

        // Antigravity Project ID injection
        if (currentProvider === 'antigravity' && isOAuthCredential(credential)) {
          let projectId = credential.projectId
          if (!projectId) {
            try {
              const pid = await fetchAntigravityProjectID(credential.accessToken)
              projectId = pid || ANTIGRAVITY_DEFAULT_PROJECT_ID
              credential.projectId = projectId
              await CredentialStorage.update(currentProvider, credential)
            } catch {
              projectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
            }
          }
          requestBody.project = projectId
        }

        // Opencode Zen Anthropic version injection
        if (currentProvider === 'opencode-zen' && effectiveTargetProvider === 'anthropic') {
          headers['anthropic-version'] = '2023-06-01'
          if (!headers['x-api-key'] && credential && 'key' in credential) {
            headers['x-api-key'] = (credential as { key: string }).key
          }
        }
      } else {
        headers = buildHeaders(currentProvider, options.apiKey, effectiveTargetProvider)
        let url = PROVIDER_ENDPOINTS[currentProvider] || PROVIDER_ENDPOINTS[effectiveTargetProvider]
        if (currentProvider === 'opencode-zen' && effectiveTargetProvider === 'openai') {
          url = 'https://opencode.ai/zen/v1/chat/completions'
        }
        if (!url)
          return new Response(JSON.stringify({ error: 'Unknown provider' }), {
            status: 400,
          })
        endpoint = url
      }

      // Forward anthropic-beta header
      const anthropicBeta = request.headers.get('anthropic-beta')
      if (anthropicBeta) {
        headers['anthropic-beta'] = anthropicBeta
      }

      if (currentProvider === 'opencode-zen') {
        fixOpencodeZenBody(requestBody)
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
        logger.error({ error: message, endpoint }, 'Upstream fetch failed')

        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }

        return new Response(JSON.stringify({ error: message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      lastResponse = upstreamResponse

      if (upstreamResponse.status === 429) {
        const retryAfterHeader =
          upstreamResponse.headers.get('Retry-After') ||
          upstreamResponse.headers.get('rating-limit-reset')
        let retryAfterMs = 0
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10)
          if (!Number.isNaN(seconds)) retryAfterMs = seconds * 1000
        }

        if (options.router && currentModel) {
          options.router.handleRateLimit(currentModel, retryAfterMs || undefined)
          const original = originalModel || currentModel
          if (original) {
            const nextRoute = options.router.resolveModel(original)
            if (nextRoute.provider !== currentProvider || nextRoute.model !== currentModel) {
              logger.info(
                {
                  from: `${currentProvider}:${currentModel}`,
                  to: `${nextRoute.provider}:${nextRoute.model}`,
                  reason: '429 Fallback',
                },
                '[streaming] Switching to fallback model'
              )
              currentProvider = nextRoute.provider
              currentModel = nextRoute.model
              continue
            }
          }
        }

        const delay = Math.min(1000 * 2 ** (attempt - 1), 16000)
        await new Promise((r) => setTimeout(r, delay))

        if (authProvider && !options.apiKey && authProvider.rotate) {
          authProvider.rotate()
        }
        continue
      }

      break
    } // End retry loop

    if (!lastResponse) {
      return new Response(JSON.stringify({ error: 'Request failed' }), {
        status: 500,
      })
    }

    // Check execution flow - if successful, proceed to streaming logic
    const upstreamResponse = lastResponse // Used by existing logic below

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
      let errorBody = ''
      try {
        errorBody = await upstreamResponse.text()
      } catch {
        errorBody = 'Failed to read error body'
      }

      logger.error(
        {
          status: upstreamResponse.status,
          body: errorBody,
          responseHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
          requestHeaders: headers,
          endpoint,
          requestBodyPreview: JSON.stringify(requestBody).slice(0, 1000),
        },
        'Upstream returned error'
      )

      return new Response(errorBody, {
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
    const parsingProvider = effectiveTargetProvider

    let buffer = ''
    let sentMessageStart = false
    // Block state for thinking/text block management
    let currentBlockIndex = 0
    let currentBlockType: 'thinking' | 'text' | 'tool_use' | null = null

    // Signature caching state for Claude thinking models
    const thoughtBuffer = new Map<number, string>()

    // Helper function to detect block type from transformed SSE output
    const detectBlockType = (sse: string): 'thinking' | 'text' | 'tool_use' | 'stop' | null => {
      if (sse.includes('"type":"message_stop"') || sse.includes('"type":"message_delta"')) {
        return 'stop'
      }

      // Explicit start events
      if (sse.includes('"type":"content_block_start"')) {
        if (sse.includes('"thinking"')) return 'thinking'
        if (sse.includes('"text"')) return 'text'
        if (sse.includes('"tool_use"')) return 'tool_use'
      }

      // Delta events (implicit start)
      if (sse.includes('"type":"thinking_delta"') || sse.includes('"type":"signature_delta"')) {
        return 'thinking'
      }
      if (sse.includes('"type":"text_delta"')) {
        return 'text'
      }
      if (sse.includes('"type":"input_json_delta"')) {
        return 'tool_use'
      }
      return null
    }

    // Helper function to send content_block_start event
    const sendBlockStart = (
      blockType: 'thinking' | 'text' | 'tool_use' | 'stop',
      index: number,
      controller: TransformStreamDefaultController<Uint8Array>
    ) => {
      if (blockType === 'thinking') {
        const event = `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`
        logger.debug({ index, blockType }, '[streaming] Sending block start (thinking)')
        controller.enqueue(encoder.encode(event))
      } else if (blockType === 'tool_use') {
        // We cannot synthesize a valid tool_use start without ID/Name.
        // This implies an upstream protocol error or missing start event.
        logger.error(
          { index, blockType },
          '[streaming] CRITICAL: Attempted to start tool_use block implicitly without ID/Name. Stream may be corrupted.'
        )
        // We do not enqueue anything, hoping the client handles the orphan delta or we are in a weird state.
        // Sending a text block here (previous behavior) would guarantee corruption.
      } else {
        const event = `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`
        logger.debug({ index, blockType }, '[streaming] Sending block start (text)')
        controller.enqueue(encoder.encode(event))
      }
    }

    // Helper function to send content_block_stop event
    const sendBlockStop = (
      index: number,
      controller: TransformStreamDefaultController<Uint8Array>
    ) => {
      const event = `event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`
      logger.debug({ index }, '[streaming] Sending block stop')
      controller.enqueue(encoder.encode(event))
    }

    // Process transformed chunks with block type tracking
    const processChunk = (
      chunk: string,
      controller: TransformStreamDefaultController<Uint8Array>
    ) => {
      if (!chunk.trim()) return

      const chunkBlockType = detectBlockType(chunk)
      const isBlockStart = chunk.includes('"type":"content_block_start"')
      const isBlockStop = chunk.includes('"type":"content_block_stop"')

      if (sourceFormat === 'anthropic') {
        // 1. Handle message end events
        // 1. Handle message end events
        if (chunkBlockType === 'stop') {
          let finalChunk = chunk
          if (currentBlockType !== null) {
            // If we are closing a tool_use block, we MUST ensure the stop_reason is "tool_use".
            // Gemini (Antigravity) may send "STOP" -> "end_turn" even for tool calls.
            if (currentBlockType === 'tool_use') {
              logger.debug(
                '[streaming] Patching stop_reason: end_turn -> tool_use for tool_use block'
              )
              finalChunk = finalChunk.replace(
                /"stop_reason":"end_turn"/g,
                '"stop_reason":"tool_use"'
              )
            }
            sendBlockStop(currentBlockIndex, controller)
            currentBlockType = null
          }
          controller.enqueue(encoder.encode(finalChunk))
          return
        }

        // 2. Handle Block Start / Transitions
        if (isBlockStart) {
          // Explicit start: Close current if exists, then START NEW
          if (currentBlockType !== null) {
            sendBlockStop(currentBlockIndex, controller)
            currentBlockIndex++ // Increment for the new block
          }
          // Set currentBlockType to the type of the new explicit block
          if (chunkBlockType) currentBlockType = chunkBlockType
        } else if (chunkBlockType && chunkBlockType !== currentBlockType) {
          // Implicit switch (e.g., thinking_delta after text_delta)
          if (currentBlockType !== null) {
            sendBlockStop(currentBlockIndex, controller)
            currentBlockIndex++
          }
          sendBlockStart(chunkBlockType, currentBlockIndex, controller)
          currentBlockType = chunkBlockType
        } else if (currentBlockType === null && chunkBlockType) {
          // Implicit start from null (first delta event)
          sendBlockStart(chunkBlockType, currentBlockIndex, controller)
          currentBlockType = chunkBlockType
        }
      } // End anthropic logic setup

      // Log text content for debugging
      if (chunkBlockType === 'text') {
        const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/)
        if (textMatch?.[1]) {
          logger.debug(
            { textContent: textMatch[1].slice(0, 100) },
            '[streaming] Text chunk content'
          )
        }
      }

      // Cache signatures
      if (
        shouldCacheSignaturesForModel &&
        signatureSessionKey &&
        (chunkBlockType === 'thinking' || currentBlockType === 'thinking')
      ) {
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

      // 4. Update index and send
      const updatedChunk = chunk.replace(/"index":\s*\d+/g, `"index":${currentBlockIndex}`)

      logger.debug(
        {
          updatedIndex: currentBlockIndex,
          chunkLength: updatedChunk.length,
          type: chunkBlockType,
          isStart: isBlockStart,
          isStop: isBlockStop,
        },
        '[streaming] Sending updated chunk'
      )
      controller.enqueue(encoder.encode(updatedChunk))

      // Post-process state updates
      if (sourceFormat === 'anthropic' && isBlockStop) {
        currentBlockType = null // Reset current block type as this block is now stopped
        currentBlockIndex++ // Prepare index for next block
      }
    }

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        logger.debug({ chunkSize: chunk.length }, '[streaming] Received chunk')
        const text = decoder.decode(chunk, { stream: true })
        logger.debug(
          {
            service: 'streaming-handler',
            textPreview: text.slice(0, 200),
          },
          '[streaming] Chunk content'
        )
        buffer += text

        // Process complete SSE events
        let rawEvents: string[]

        if (parsingProvider === 'antigravity' || parsingProvider === 'gemini') {
          // Antigravity/Gemini: split by newline, look for "data:" lines
          const lines = buffer.split('\n')
          rawEvents = []

          // If buffer doesn't end with newline, the last line might be incomplete
          const lastLineIncomplete = !text.endsWith('\n')

          // Process all complete lines
          const linesToProcess = lastLineIncomplete ? lines.slice(0, -1) : lines
          const remainingLine = lastLineIncomplete ? (lines[lines.length - 1] ?? '') : ''

          for (const line of linesToProcess) {
            if (line.startsWith('data:')) {
              rawEvents.push(line)
            }
          }
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
            parsingProvider,
            sourceFormat,
          },
          '[streaming] Processing events'
        )

        for (const rawEvent of rawEvents) {
          if (!rawEvent.trim()) continue

          logger.debug({ rawEvent: rawEvent.slice(0, 300) }, '[streaming] Processing raw event')

          const eventWithNewline = `${rawEvent}\n\n`

          // console.error(`[streaming] Event ${eventCount}: from=${targetProvider}, to=${sourceFormat}, chunk_len=${eventWithNewline.length}`)

          try {
            // For Anthropic format, we need to ensure message_start is sent first
            if (sourceFormat === 'anthropic' && !sentMessageStart) {
              sentMessageStart = true
              const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
              const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
              controller.enqueue(encoder.encode(messageStart))
              logger.debug('Sent message_start event')
            }

            const transformed = transformStreamChunk(
              eventWithNewline,
              parsingProvider,
              sourceFormat
            )

            if (Array.isArray(transformed)) {
              for (const t of transformed) {
                processChunk(t, controller)
              }
            } else if (transformed) {
              processChunk(transformed, controller)
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

              try {
                if (sourceFormat === 'anthropic' && !sentMessageStart) {
                  sentMessageStart = true
                  const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_${Math.random()
                    .toString(36)
                    .slice(
                      2,
                      11
                    )}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
                  controller.enqueue(encoder.encode(messageStart))
                }

                const transformed = transformStreamChunk(
                  eventWithNewline,
                  parsingProvider,
                  sourceFormat
                )

                if (Array.isArray(transformed)) {
                  for (const t of transformed) {
                    processChunk(t, controller)
                  }
                } else if (transformed) {
                  processChunk(transformed, controller)
                }
              } catch (error) {
                logger.error(
                  {
                    error: error instanceof Error ? error.message : String(error),
                  },
                  'Stream flush transform error'
                )
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

// Helper types for Opencode Zen modifications
interface OpencodeZenTool {
  name?: string
  description?: string
  input_schema?: Record<string, unknown>
}

function stripBetaFields(body: Record<string, unknown> | unknown[]) {
  if (!body || typeof body !== 'object') return

  if (!Array.isArray(body) && 'cache_control' in body) {
    delete body.cache_control
  }

  if (Array.isArray(body)) {
    body.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        stripBetaFields(item as Record<string, unknown>)
      }
    })
  } else {
    for (const key in body) {
      if (Object.hasOwn(body, key)) {
        const value = (body as Record<string, unknown>)[key]
        if (typeof value === 'object' && value !== null) {
          stripBetaFields(value as Record<string, unknown>)
        }
      }
    }
  }
}

function fixOpencodeZenBody(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') return

  // 1. Remove unsupported fields
  stripBetaFields(body)

  // 2. Fix tools format (Anthropic input_schema -> OpenAI function)
  const tools = body.tools as unknown[]

  if (Array.isArray(tools) && tools.length > 0) {
    const firstTool = tools[0] as OpencodeZenTool
    if (firstTool.input_schema) {
      body.tools = tools.map((t) => {
        const tool = t as OpencodeZenTool
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        }
      })
    }
  }

  // 3. Ensure messages are in a format Opencode Zen likes
  // Reverted: Do NOT simplify content to string, as it might be required to stay as an array
}
