import {
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  AuthProviderRegistry,
  CredentialStorage,
  fetchAntigravityProjectID,
  isApiKeyCredential,
  isOAuthCredential,
  TokenRefresh,
} from '@llmux/auth'
import {
  createLogger,
  getProvider,
  isValidProviderName,
  type ProviderName,
  stripSignaturesFromContents,
  transformRequest,
} from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  applyAntigravityAlias,
  fixOpencodeZenBody,
  getCodexInstructions,
  resolveOpencodeZenProtocol,
  shouldFallbackToDefaultProject,
  transformToolsForCodex,
} from '../providers'
import { accountRotationManager } from './account-rotation'
import { normalizeBashArguments } from './bash-normalization'
import { applyModelMappingV2 } from './model-mapping'
import {
  buildSignatureSessionKey,
  cacheSignatureFromChunk,
  ensureThinkingSignatures,
  extractConversationKey,
  shouldCacheSignatures,
  type UnifiedRequestBody,
} from './signature-integration'

const logger = createLogger({ service: 'streaming-handler' })

import { buildUpstreamHeaders, getDefaultEndpoint, parseRetryAfterMs } from '../upstream'
export { parseRetryAfterMs }

import type { Router } from '../routing'

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider: string
  targetModel?: string
  apiKey?: string
  thinking?: boolean
  modelMappings?: AmpModelMapping[]
  router?: Router
}

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

function buildHeaders(
  targetProvider: string,
  apiKey?: string,
  fromProtocol?: string
): Record<string, string> {
  return buildUpstreamHeaders(targetProvider, apiKey, { fromProtocol })
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
  const startTime = Date.now()
  const reqId = Math.random().toString(36).slice(2, 8)

  // Context to accumulate log data
  const streamContext = {
    reqId,
    fromFormat: options.sourceFormat,
    targetProvider: options.targetProvider,
    targetModel: options.targetModel || 'unknown',
    originalModel: 'unknown',
    finalModel: 'unknown',
    chunkCount: 0,
    totalBytes: 0,
    duration: 0,
    error: undefined as string | undefined,
    requestInfo: undefined as
      | {
          model: string
          provider: string
          endpoint: string
          toolsCount: number
          bodyLength: number
        }
      | undefined,
    fullResponse: '',
    accumulatedText: '',
    accumulatedThinking: '',
  }

  // logger.debug({ reqId, ...options }, '[Streaming] Init')

  try {
    const body = (await request.json()) as {
      model?: string
      thinking?: { type?: string; budget_tokens?: number } | unknown
      reasoning_effort?: unknown
    }
    const originalModel = body.model ?? 'unknown'
    streamContext.originalModel = originalModel

    let initialMappedModel: string | undefined = originalModel
    let initialTargetProvider = options.targetProvider

    // Check if thinking was explicitly requested in the original request
    const hasThinkingInRequest = body.thinking !== undefined || body.reasoning_effort !== undefined
    const thinkingType =
      typeof body.thinking === 'object' && body.thinking !== null && 'type' in body.thinking
        ? (body.thinking as { type?: string }).type
        : undefined
    let isThinkingEnabled: boolean | undefined = hasThinkingInRequest
      ? thinkingType === 'enabled' || body.reasoning_effort !== undefined
      : undefined

    if (originalModel !== 'unknown') {
      const mappingResult = applyModelMappingV2(originalModel, options.modelMappings)
      const appliedMapping = mappingResult.model
      // Priority: options.thinking > mappingResult.thinking > original request thinking
      if (options.thinking !== undefined) {
        isThinkingEnabled = options.thinking
      } else if (mappingResult.thinking !== undefined) {
        isThinkingEnabled = mappingResult.thinking
      }
      // If still undefined after mapping, keep original request's thinking setting

      logger.debug(
        {
          reqId,
          originalModel,
          isThinkingEnabled,
          sourceFormat: options.sourceFormat,
          targetModel: initialMappedModel,
          fromOptions: options.thinking !== undefined,
        },
        '[streaming] Model mapping result for thinking control'
      )

      if (mappingResult.provider && isValidProviderName(mappingResult.provider)) {
        initialTargetProvider = mappingResult.provider as ProviderName
      }
      initialMappedModel = appliedMapping
    }

    if (options.targetModel) {
      initialMappedModel = options.targetModel
    }

    // Capture effective target provider for debug logs
    let effectiveTargetProvider: ProviderName
    try {
      effectiveTargetProvider = initialTargetProvider as ProviderName
      if (initialTargetProvider === 'opencode-zen' && initialMappedModel) {
        const protocol = resolveOpencodeZenProtocol(initialMappedModel)
        if (protocol) {
          effectiveTargetProvider = protocol as ProviderName
        }
      }
    } catch {
      effectiveTargetProvider = 'openai' as ProviderName
    }

    // Determine parser type early for logging
    let parserType = 'sse-standard'
    try {
      const provider = getProvider(effectiveTargetProvider)
      if (provider?.config?.defaultStreamParser) {
        parserType = provider.config.defaultStreamParser
      }
    } catch {
      // Ignore
    }

    logger.debug(
      {
        reqId,
        originalModel,
        initialMappedModel,
        effectiveTargetProvider,
        isThinkingEnabled,
      },
      '[streaming] Thinking control status initialized'
    )

    const isStreamingLoop = true
    let currentProvider = initialTargetProvider
    let currentModel = initialMappedModel
    let previousProvider = initialTargetProvider // Track model changes for signature handling
    let previousModel = initialMappedModel
    let attemptCount = 0
    const MAX_ATTEMPTS = 10

    // Retry loop for rotation
    // const MAX_ATTEMPTS = 10; // This was moved to attemptCount
    // let attempt = 0; // This was moved to attemptCount
    // let currentProvider = initialTargetProvider; // This was moved above
    // let currentModel = initialMappedModel; // This was moved above
    let antigravityEndpointIndex = 0 // State for Antigravity endpoint iteration

    // Variables hoisted
    // let effectiveTargetProvider: ProviderName = // This was moved above
    //   initialTargetProvider as ProviderName;
    let requestBody: Record<string, unknown> = {}
    let endpoint: string = ''
    let headers: Record<string, string> = {}
    let shouldCacheSignaturesForModel: boolean = false
    let signatureSessionKey: string | undefined
    let overrideProjectId: string | null = null // For Project ID Fallback

    while (attemptCount < MAX_ATTEMPTS && isStreamingLoop) {
      attemptCount++

      // [THINKING CONTROL] Strip thinking param if disabled
      if (isThinkingEnabled !== true) {
        if (body.thinking) {
          logger.info(
            { reqId, model: originalModel },
            "[streaming] REQUEST MODIFICATION: Stripping 'thinking' parameter from Anthropic request body to prevent upstream generation"
          )
          delete body.thinking
        }
        // Additional: If it's an OpenAI-style request, ensure no reasoning is requested
        if (body.reasoning_effort) {
          logger.info(
            { reqId },
            "[streaming] REQUEST MODIFICATION: Stripping 'reasoning_effort' parameter from OpenAI request body"
          )
          delete body.reasoning_effort
        }

        // Add a hint to the system message if possible? (Optional, might be too intrusive)
      }
      // Variables for this attempt
      let credentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
      let accountIndex = 0

      // Update context
      streamContext.targetProvider = currentProvider
      streamContext.finalModel = currentModel || 'unknown'

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
      // LOG ORIGINAL REQUEST
      const originalTools = Array.isArray((body as Record<string, unknown>).tools)
        ? ((body as Record<string, unknown>).tools as Array<{ name?: string }>).length
        : 0
      const originalMessages = Array.isArray((body as Record<string, unknown>).messages)
        ? ((body as Record<string, unknown>).messages as Array<unknown>).length
        : 0
      logger.debug(
        {
          from: formatToProvider(options.sourceFormat),
          to: effectiveTargetProvider,
          originalToolsCount: originalTools,
          originalMessagesCount: originalMessages,
          hasSystem: !!(body as Record<string, unknown>).system,
        },
        '[streaming] BEFORE transform - original request'
      )

      let transformedRequest: unknown
      try {
        transformedRequest = transformRequest(body, {
          from: formatToProvider(options.sourceFormat),
          to: effectiveTargetProvider,
          model: currentModel,
          // Disable thinking if not explicitly enabled (false or undefined means no thinking)
          thinkingOverride: isThinkingEnabled !== true ? { enabled: false } : undefined,
        })

        requestBody = transformedRequest as Record<string, unknown>

        // Strip thoughtSignature if model changed (cross-model fallback)
        // This prevents "Corrupted thought signature" errors when falling back
        const modelChanged = previousProvider !== currentProvider || previousModel !== currentModel
        const hasContents =
          effectiveTargetProvider === 'antigravity' &&
          (requestBody.request as Record<string, unknown> | undefined)?.contents
        if (modelChanged && hasContents) {
          const innerRequest = requestBody.request as Record<string, unknown>
          const contents = innerRequest.contents as Array<{
            role: string
            parts: Array<{ thoughtSignature?: string; [key: string]: unknown }>
          }>
          if (Array.isArray(contents)) {
            const stripped = stripSignaturesFromContents(contents)
            innerRequest.contents = stripped
            logger.debug(
              {
                reqId,
                from: `${previousProvider}:${previousModel}`,
                to: `${currentProvider}:${currentModel}`,
              },
              '[streaming] Stripped thoughtSignature during model fallback'
            )
          }
        }

        // Update tracking variables for next iteration
        previousProvider = currentProvider
        previousModel = currentModel
      } catch (error) {
        streamContext.error = error instanceof Error ? error.message : String(error)
        logger.error(
          {
            service: 'streaming-handler',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            bodyKeys: Object.keys(body as object),
            options,
          },
          '[streaming] Error transforming request'
        )
        throw error
      }

      // Transform output is a union type based on target provider, narrow to base request object
      requestBody = transformedRequest as Record<string, unknown>

      // LOG TRANSFORMED REQUEST
      // Antigravity implementation uses a wrapper object with a 'request' property
      const unwrappedRequest = (requestBody.request as Record<string, unknown>) || requestBody

      const transformedTools = Array.isArray(unwrappedRequest.tools)
        ? (unwrappedRequest.tools as unknown[]).reduce((acc: number, tool) => {
            const t = tool as { functionDeclarations?: unknown[] }
            if (t.functionDeclarations && Array.isArray(t.functionDeclarations)) {
              return acc + t.functionDeclarations.length
            }
            return acc + 1
          }, 0)
        : Array.isArray(unwrappedRequest.functionDeclarations)
          ? (unwrappedRequest.functionDeclarations as unknown[]).length
          : Array.isArray(
                (
                  unwrappedRequest as {
                    tool_config?: { function_declarations?: unknown[] }
                  }
                ).tool_config?.function_declarations
              )
            ? ((
                unwrappedRequest as {
                  tool_config?: { function_declarations?: unknown[] }
                }
              ).tool_config?.function_declarations?.length ?? 0)
            : 0

      const transformedContents = Array.isArray(unwrappedRequest.contents)
        ? (unwrappedRequest.contents as unknown[]).length
        : Array.isArray(unwrappedRequest.messages)
          ? (unwrappedRequest.messages as unknown[]).length
          : 0

      logger.debug(
        {
          provider: currentProvider,
          isWrapped: !!requestBody.request,
          transformedToolsCount: transformedTools,
          transformedContentsCount: transformedContents,
          hasSystemInstruction: !!unwrappedRequest.systemInstruction,
          requestBodyKeys: Object.keys(requestBody).join(', '),
          unwrappedKeys: Object.keys(unwrappedRequest).join(', '),
        },
        '[streaming] AFTER transform - transformed request'
      )

      if (currentModel) {
        // Antigravity transform handles internal model aliases
        // Only overwrite requestBody.model if there's an explicit mapping or if not Antigravity
        // Or if we have switched models via fallback
        if (currentProvider !== 'antigravity' || currentModel !== originalModel) {
          requestBody.model = currentModel
        }
      }

      // Apply Project ID override if set (for License Error Fallback)
      if (overrideProjectId && currentProvider === 'antigravity') {
        ;(requestBody as Record<string, unknown>).project = overrideProjectId
        logger.debug({ overrideProjectId }, '[streaming] Applied Project ID override')
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
        logger.debug(
          {
            model: currentModel,
            provider: currentProvider,
            conversationKey,
            sessionKey: signatureSessionKey?.slice(0, 50),
          },
          '[tools+signature] Preparing signature restoration for Claude thinking model'
        )
        // Pass model to ensure only Claude thinking models are processed
        ensureThinkingSignatures(requestBody, signatureSessionKey, currentModel)
        logger.debug(
          { sessionKey: signatureSessionKey?.slice(0, 50) },
          '[tools+signature] ensureThinkingSignatures completed'
        )
      }

      const authProvider = AuthProviderRegistry.get(currentProvider)

      // Reset for this attempt (using hoisted variables)
      endpoint = ''
      headers = {}

      if (authProvider && (!options.apiKey || options.apiKey === 'dummy')) {
        // ... (Credential logic)
        try {
          // Default endpoint retrieval
          endpoint = authProvider.getEndpoint(options.targetModel || 'gemini-pro', {
            streaming: true,
          })
        } catch {
          // Fallback for providers that don't support getEndpoint with options or if it fails
          endpoint = ''
        }

        // Antigravity Endpoint Logic with Scoped Provider Key
        let effectiveProviderKey = currentProvider

        if (currentProvider === 'antigravity') {
          const baseEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[antigravityEndpointIndex]
          const apiPath = ANTIGRAVITY_API_PATH_STREAM // Always streaming in this handler
          endpoint = `${baseEndpoint}${apiPath}`

          // Scoped provider key for account rotation (antigravity:https://example.com)
          effectiveProviderKey = `antigravity:${baseEndpoint}`

          logger.debug(
            {
              reqId, // Changed from attempt
              endpoint,
              endpointIndex: antigravityEndpointIndex,
              baseEndpoint,
              effectiveProviderKey,
            },
            '[streaming] Using Antigravity endpoint'
          )
        }

        // Simplified credential retrieval for retry loop context
        try {
          // Pass effectiveProviderKey if supported, otherwise use currentProvider and we manage scope manually?
          // TokenRefresh.ensureFresh typically takes the provider name.
          // For Antigravity, the tokens are shared across endpoints, so we verify against the main provider name.
          credentials = await TokenRefresh.ensureFresh(currentProvider)
        } catch {
          logger.warn({ reqId, provider: currentProvider }, 'No credentials found')
          // If failed, break or return 401
          return new Response(JSON.stringify({ error: `No credentials for ${currentProvider}` }), {
            status: 401,
          })
        }

        // Use effectiveProviderKey for rotation state to separate cooldowns per endpoint
        accountIndex = accountRotationManager.getNextAvailable(
          effectiveProviderKey,
          credentials || []
        )
        const credential = credentials?.[accountIndex]

        if (!credential)
          return new Response(JSON.stringify({ error: `No credentials` }), {
            status: 401,
          })

        headers = await authProvider.getHeaders(credential, {
          model: options.targetModel,
        })

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

        // --- RETRY / ERROR HANDLING LOGIC MOVED INSIDE ---
        // Need to ensure we use effectiveProviderKey for markRateLimited below
      } else {
        // Logic for API Key provided (no rotation)
        let effectiveApiKey = options.apiKey

        if (!effectiveApiKey && currentProvider === 'openai') {
          // Attempt fallback lookup for openai-web/codex credentials
          const fallbackKeys = ['openai', 'openai-web', 'codex']
          for (const key of fallbackKeys) {
            const creds = await CredentialStorage.get(key)
            if (creds.length > 0) {
              const cred = creds[0]
              let foundKey: string | undefined
              if (cred && isOAuthCredential(cred)) {
                foundKey = cred.accessToken
              } else if (cred && isApiKeyCredential(cred)) {
                foundKey = cred.key
              }
              if (foundKey) {
                effectiveApiKey = foundKey
                break
              }
            }
          }
        }

        headers = buildHeaders(currentProvider, effectiveApiKey, effectiveTargetProvider)
        let url =
          getDefaultEndpoint(currentProvider, { streaming: true }) ||
          getDefaultEndpoint(effectiveTargetProvider, { streaming: true })
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

      // Handle openai-web (Codex) format: requires instructions field
      if (currentProvider === 'openai-web') {
        // Codex backend requires instructions, store, and stream fields
        // Fetch instructions from GitHub with caching (or use system message)
        const systemInstructions =
          ((requestBody as Record<string, unknown>).system as string) || undefined
        const instructions =
          systemInstructions || (await getCodexInstructions(currentModel || 'gpt-5.1'))

        // Transform tools from ChatCompletion API format to Responses API format
        // ChatCompletion: { type: "function", function: { name, description, parameters } }
        // Responses API: { type: "function", name, description, parameters }
        const rawTools = (requestBody as Record<string, unknown>).tools as
          | Array<{
              type?: string
              name?: string
              description?: string
              parameters?: unknown
              input_schema?: unknown
              function?: {
                name?: string
                description?: string
                parameters?: unknown
              }
            }>
          | undefined
        const transformedTools = rawTools ? transformToolsForCodex(rawTools) : undefined

        const reasoningField = (requestBody as Record<string, unknown>).reasoning && {
          reasoning: (requestBody as Record<string, unknown>).reasoning,
        }

        const codexBody: Record<string, unknown> = {
          model: currentModel || 'gpt-5.1',
          instructions,
          input: (requestBody as Record<string, unknown>).messages,
          store: false,
          stream: true,
        }

        if (transformedTools && transformedTools.length > 0) {
          codexBody.tools = transformedTools
        }
        if (reasoningField) {
          Object.assign(codexBody, reasoningField)
        }

        requestBody = codexBody
        logger.info(
          {
            hasInstructions: !!instructions,
            model: currentModel,
            toolsCount: transformedTools?.length ?? 0,
            toolNames: transformedTools?.slice(0, 5).map((t) => t.name) ?? [],
          },
          '[streaming] openai-web codex body constructed'
        )
      }

      if (currentProvider === 'opencode-zen') {
        fixOpencodeZenBody(requestBody, { thinkingEnabled: isThinkingEnabled })
      }

      // Enhanced logging for debugging
      const requestBodyToLog = (requestBody.request as Record<string, unknown>) || requestBody
      const toolsCount = Array.isArray(requestBodyToLog.tools) ? requestBodyToLog.tools.length : 0
      const bodyToLog = JSON.stringify(requestBody)
      // Buffer request info for consolidated logging at completion
      streamContext.requestInfo = {
        model: String(requestBody.model || 'unknown'),
        provider: effectiveTargetProvider,
        endpoint: endpoint.slice(0, 60) + (endpoint.length > 60 ? '...' : ''),
        toolsCount,
        bodyLength: bodyToLog.length,
      }

      // DEBUG: Log request details before sending
      logger.debug(
        {
          reqId,
          attempt: attemptCount, // Changed from attempt
          endpoint,
          requestHeaders: Object.keys(headers).reduce(
            (acc, key) => {
              // Mask sensitive header values
              const lowerKey = key.toLowerCase()
              if (
                lowerKey.includes('auth') ||
                lowerKey.includes('key') ||
                lowerKey.includes('token')
              ) {
                acc[key] = '[REDACTED]'
              } else {
                acc[key] = headers[key] ?? ''
              }
              return acc
            },
            {} as Record<string, string>
          ),
          bodyPreview: bodyToLog.slice(0, 500),
          bodyLength: bodyToLog.length,
        },
        '[streaming] Sending upstream request'
      )

      let upstreamResponse: Response
      try {
        upstreamResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        })
      } catch (error) {
        streamContext.error = error instanceof Error ? error.message : 'Network error'
        logger.warn(
          {
            reqId,
            error: streamContext.error,
            attempt: attemptCount, // Changed from attempt
            maxAttempts: MAX_ATTEMPTS,
          },
          '[streaming] Upstream fetch failed'
        )

        if (attemptCount < MAX_ATTEMPTS) {
          // Changed from attempt < MAX_ATTEMPTS
          const delay = Math.min(1000 * 2 ** (attemptCount - 1), 8000) // Changed from attempt - 1
          logger.debug(
            { reqId, attempt: attemptCount, delayMs: delay }, // Changed from attempt
            '[streaming] Retrying after network error'
          )
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        return new Response(JSON.stringify({ error: streamContext.error }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // DEBUG: Log response headers
      logger.debug(
        {
          reqId,
          attempt: attemptCount, // Changed from attempt
          status: upstreamResponse.status,
          responseHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
        },
        '[streaming] Received upstream response'
      )

      if (upstreamResponse.status === 429) {
        let bodyText = ''
        try {
          bodyText = await upstreamResponse.clone().text()
        } catch {}

        const parsedRetryAfter = parseRetryAfterMs(upstreamResponse, bodyText)

        // Provider-specific default retry-after values
        const defaultRetryAfter = currentProvider === 'opencode-zen' ? 300000 : 30000
        const retryAfterMs = parsedRetryAfter || defaultRetryAfter

        // Use effectiveProviderKey (scoped for Antigravity)
        const effectiveKey =
          currentProvider === 'antigravity'
            ? `antigravity:${ANTIGRAVITY_ENDPOINT_FALLBACKS[antigravityEndpointIndex]}`
            : currentProvider

        accountRotationManager.markRateLimited(effectiveKey, accountIndex, retryAfterMs)

        logger.warn(
          {
            reqId,
            attempt: attemptCount, // Changed from attempt
            retryAfterMs,
            provider: effectiveKey,
            model: currentModel,
            accountIndex,
          },
          '[streaming] Rate limited (429)'
        )

        if (options.router && currentModel) {
          options.router.handleRateLimit(currentModel, retryAfterMs || undefined)

          // HIERARCHICAL FALLBACK LOGIC
          const allLimited = accountRotationManager.areAllRateLimited(
            effectiveKey,
            credentials || []
          )

          if (allLimited) {
            // 1. Antigravity: Try Next Endpoint
            if (currentProvider === 'antigravity') {
              const nextEndpointIndex = antigravityEndpointIndex + 1
              if (nextEndpointIndex < ANTIGRAVITY_ENDPOINT_FALLBACKS.length) {
                logger.info(
                  {
                    reqId,
                    currentEndpointIndex: antigravityEndpointIndex,
                    nextEndpointIndex,
                    reason: 'All accounts limited on current endpoint',
                  },
                  '[streaming] Switching to next Antigravity endpoint'
                )
                antigravityEndpointIndex = nextEndpointIndex
                continue // Retry immediately with next endpoint
              }
            }

            // 2. Model Fallback (All endpoints exhausted or not Antigravity)
            const original = originalModel || currentModel
            if (original) {
              const nextRoute = options.router.resolveModel(original)
              if (nextRoute.provider !== currentProvider || nextRoute.model !== currentModel) {
                logger.info(
                  {
                    from: `${currentProvider}:${currentModel}`,
                    to: `${nextRoute.provider}:${nextRoute.model}`,
                    reason: '429 Fallback (All Accounts/Endpoints Limited)',
                  },
                  '[streaming] Switching to fallback model'
                )
                currentProvider = nextRoute.provider
                currentModel = nextRoute.model
                // Reset endpoint index for new provider (though if switching BACK to AG it resets to 0 which is correct)
                antigravityEndpointIndex = 0
                continue
              }
            }
          }
        }

        // Standard wait logic (if not fully exhausted or fallback failed)
        // If we are here, it means we didn't (or couldn't) switch endpoint or model.
        // We must wait.
        // Recalculate isAllLimited based on effectiveKey
        const effectiveKeyForWait =
          currentProvider === 'antigravity'
            ? `antigravity:${ANTIGRAVITY_ENDPOINT_FALLBACKS[antigravityEndpointIndex]}`
            : currentProvider

        const isAllLimited = accountRotationManager.areAllRateLimited(
          effectiveKeyForWait,
          credentials || []
        )
        const delay = isAllLimited ? Math.min(retryAfterMs, 30000) : 0

        logger.debug(
          { reqId, attempt: attemptCount, delayMs: delay }, // Changed from attempt
          '[streaming] Waiting before retry'
        )
        await new Promise((r) => setTimeout(r, delay))

        if (authProvider?.rotate) {
          authProvider.rotate()
        }
        continue
      }

      if (!upstreamResponse.ok) {
        let errorBody = ''
        try {
          errorBody = await upstreamResponse.text()
        } catch {
          errorBody = 'Failed to read error body'
        }

        // Antigravity Project ID Fallback for License Error (#3501)
        if (
          currentProvider === 'antigravity' &&
          (upstreamResponse.status === 403 || upstreamResponse.status === 400) &&
          attemptCount < MAX_ATTEMPTS // Changed from attempt < MAX_ATTEMPTS
        ) {
          const currentProject = (requestBody as Record<string, unknown>).project as
            | string
            | undefined
          if (
            shouldFallbackToDefaultProject({
              errorBody,
              status: upstreamResponse.status,
              currentProject,
            })
          ) {
            logger.warn(
              {
                attempt: attemptCount, // Changed from attempt
                currentProject,
                defaultProject: ANTIGRAVITY_DEFAULT_PROJECT_ID,
              },
              '[streaming] License error detected. Switching to default project ID and retrying.'
            )
            overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID

            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
        }

        logger.error(
          {
            status: upstreamResponse.status,
            body: errorBody,
            responseHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
            requestHeaders: headers,
            endpoint,
            requestBody: JSON.stringify(requestBody), // Log full body for debugging
            messagesRaw: Array.isArray((requestBody as Record<string, unknown>).messages)
              ? JSON.stringify((requestBody as Record<string, unknown>).messages).slice(0, 1000)
              : 'missing',
          },
          'Upstream returned error'
        )

        return new Response(errorBody, {
          status: upstreamResponse.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // SUCCESS - Setup Stream Processing
      if (!upstreamResponse.body) {
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const decoder = new TextDecoder()
      const encoder = new TextEncoder()

      let buffer = ''
      // Anthropic / Flux vars
      let currentBlockType: 'thinking' | 'text' | 'tool_use' | null = null
      let currentBlockIndex = 0
      let sentMessageStart = false
      const thoughtBuffer = new Map<number, string>()

      // Context Setup for Stream
      const parsingProvider = effectiveTargetProvider
      const sourceFormat = options.sourceFormat

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
        if (
          sse.includes('"type":"thinking_delta"') ||
          sse.includes('"type":"signature_delta"') ||
          sse.includes('"type":"thinking"')
        ) {
          return 'thinking'
        }
        if (sse.includes('"type":"text_delta"') || sse.includes('"type":"text"')) {
          return 'text'
        }
        if (sse.includes('"type":"tool_use"')) {
          return 'tool_use'
        }
        // input_json_delta should NOT start a new block - it's part of existing tool_use block
        if (sse.includes('"type":"input_json_delta"')) {
          return 'tool_use' // Continues tool_use block
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
          controller.enqueue(encoder.encode(event))
        } else if (blockType === 'tool_use') {
          // We cannot synthesize a valid tool_use start without ID/Name.
          // This implies an upstream protocol error or missing start event.
          logger.error(
            { index, blockType },
            '[streaming] CRITICAL: Attempted to start tool_use block implicitly without ID/Name. Stream may be corrupted.'
          )
          // We do not enqueue anything, hoping the client handles the orphan delta or we are in a weird state.
        } else if (blockType === 'text') {
          const event = `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`
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
        streamContext.fullResponse += event
        controller.enqueue(encoder.encode(event))
      }

      const transformStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true })
          streamContext.totalBytes += text.length
          buffer += text

          // Process complete SSE events
          let rawEvents: string[]

          // Determine parser type from provider config
          // let parserType = "sse-standard"; // This was moved above
          try {
            const provider = getProvider(parsingProvider)
            if (provider?.config?.defaultStreamParser) {
              parserType = provider.config.defaultStreamParser
            }
          } catch {
            // Fallback to standard if provider not found
          }

          if (parserType === 'sse-line-delimited') {
            // Line-delimited SSE (e.g. Gemini, Antigravity, OpencodeZen/GLM)
            // Split by newline, look for "data:" lines
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

          for (const rawEvent of rawEvents) {
            if (!rawEvent.trim()) continue

            // DEBUG: Log raw event before processing
            logger.debug(
              {
                rawEvent: rawEvent.slice(0, 300),
                currentBlockType,
                currentBlockIndex,
              },
              '[streaming] Processing raw SSE event'
            )

            const eventWithNewline = `${rawEvent}\n\n`
            try {
              // Anthropic message_start injection
              if (sourceFormat === 'anthropic' && !sentMessageStart) {
                sentMessageStart = true
                const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
                const messageStart = `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
                streamContext.fullResponse += messageStart
                controller.enqueue(encoder.encode(messageStart))
              }

              // logger.debug(
              //   {
              //     from: parsingProvider,
              //     to: sourceFormat,
              //     chunkSample: eventWithNewline.slice(0, 200),
              //   },
              //   "[streaming] Transform chunk"
              // );
              const transformed = transformStreamChunk(
                eventWithNewline,
                parsingProvider,
                sourceFormat
              )

              // DEBUG: Log transformed chunk (use console.error to ensure it's visible)
              console.error('[STREAMING DEBUG] After transformStreamChunk:', {
                original: eventWithNewline.slice(0, 300),
                transformed: Array.isArray(transformed)
                  ? `ARRAY[${transformed.length}]:` + transformed.slice(0, 500)
                  : `STRING: ${String(transformed).slice(0, 500)}`,
              })

              // Helper to process chunk
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
                    streamContext.fullResponse += finalChunk
                    controller.enqueue(encoder.encode(finalChunk))
                    return
                  }

                  // 2. Handle Block Start / Transitions
                  if (isBlockStart) {
                    // Debug log for tool_use block start
                    if (chunkBlockType === 'tool_use') {
                      logger.debug(
                        { chunkPreview: chunk.slice(0, 500) },
                        '[streaming] tool_use content_block_start received'
                      )
                    }
                    // === EARLY FILTER: Empty text blocks (BEFORE block start logic) ===
                    // Filter out empty text blocks from Gemini - these cause client errors
                    if (chunkBlockType === 'text') {
                      const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                      const allEmpty = textMatch?.every(
                        (m) => m === '"text":""' || m === '"text": ""'
                      )
                      if (allEmpty) {
                        logger.debug('[streaming] Filtering out empty text block (early)')
                        return // Skip entirely - don't start any block
                      }
                    }

                    // Explicit start: Close current if exists, then START NEW
                    if (currentBlockType !== null) {
                      sendBlockStop(currentBlockIndex, controller)
                      currentBlockIndex++ // Increment for the new block
                    }
                    // Set currentBlockType to the type of the new explicit block
                    if (chunkBlockType) currentBlockType = chunkBlockType
                  } else if (chunkBlockType && chunkBlockType !== currentBlockType) {
                    // === EARLY FILTER: Empty text blocks (BEFORE implicit switch) ===
                    if (chunkBlockType === 'text') {
                      const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                      const allEmpty = textMatch?.every(
                        (m) => m === '"text":""' || m === '"text": ""'
                      )
                      if (allEmpty) {
                        logger.debug('[streaming] Filtering empty text on implicit switch')
                        return // Skip entirely
                      }
                    }

                    // Implicit switch (e.g., thinking_delta after text_delta)
                    if (currentBlockType !== null) {
                      sendBlockStop(currentBlockIndex, controller)
                      currentBlockIndex++
                    }
                    sendBlockStart(chunkBlockType, currentBlockIndex, controller)
                    currentBlockType = chunkBlockType
                  } else if (currentBlockType === null && chunkBlockType) {
                    // === EARLY FILTER: Empty text blocks (BEFORE implicit start) ===
                    if (chunkBlockType === 'text') {
                      const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                      const allEmpty = textMatch?.every(
                        (m) => m === '"text":""' || m === '"text": ""'
                      )
                      if (allEmpty) {
                        logger.debug('[streaming] Filtering empty text on implicit start')
                        return // Skip entirely - don't start any block
                      }
                    }

                    // Implicit start from null (first delta event)
                    sendBlockStart(chunkBlockType, currentBlockIndex, controller)
                    currentBlockType = chunkBlockType
                  }
                } // End anthropic logic setup

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
                let updatedChunk = chunk

                // Safer index update using JSON parsing to avoid corrupting user data
                // (The previous regex `/"index":\s*\d+/g` could match "index": 123 inside a string)
                try {
                  const lines = chunk.trim().split('\n')
                  const dataLineIndex = lines.findIndex((line) => line.startsWith('data: '))
                  if (dataLineIndex !== -1) {
                    const line = lines[dataLineIndex]
                    if (line) {
                      const dataContent = line.slice(6) // Remove "data: "
                      if (dataContent.trim() !== '[DONE]') {
                        try {
                          const json = JSON.parse(dataContent)
                          if (typeof json === 'object' && json !== null && 'index' in json) {
                            // [THINKING CONTROL & LOGGING]
                            const isThinkingDelta =
                              (json.type === 'content_block_delta' &&
                                json.delta &&
                                typeof json.delta.thinking === 'string') ||
                              (json.type === 'content_block_start' &&
                                json.content_block &&
                                typeof json.content_block.thinking === 'string')

                            if (isThinkingDelta && isThinkingEnabled !== true) {
                              logger.debug(
                                { reqId, type: json.type },
                                '[streaming] Thinking block detected even with thinking:false setting'
                              )
                              // We NO LONGER filter it out here to maintain transparency.
                            }

                            // Accumulate text and thinking for logging
                            if (json.type === 'content_block_delta' && json.delta) {
                              if (typeof json.delta.text === 'string')
                                streamContext.accumulatedText += json.delta.text
                              if (typeof json.delta.thinking === 'string')
                                streamContext.accumulatedThinking += json.delta.thinking
                            } else if (json.type === 'content_block_start' && json.content_block) {
                              if (typeof json.content_block.text === 'string')
                                streamContext.accumulatedText += json.content_block.text
                              if (typeof json.content_block.thinking === 'string')
                                streamContext.accumulatedThinking += json.content_block.thinking
                            }
                            json.index = currentBlockIndex

                            // if (
                            //   isThinkingDelta &&
                            //   isThinkingEnabled === false
                            // ) {
                            //   logger.debug(
                            //     { reqId },
                            //     "[streaming] Filtering out thinking block (internal) as per mapping config"
                            //   );
                            //   return;
                            // }

                            // End of accumulation logic (redundant block removed)

                            lines[dataLineIndex] = `data: ${JSON.stringify(json)}`
                            updatedChunk = `${lines.join('\n')}\n\n`
                          }
                        } catch {
                          // Ignore parse errors
                        }
                      }
                    }
                  }
                } catch (e) {
                  logger.warn(
                    { chunk: chunk.slice(0, 100), error: e },
                    '[streaming] Failed to parse/update chunk index safely, falling back to original chunk'
                  )
                }

                streamContext.chunkCount++
                logger.debug(
                  {
                    chunkPreview: updatedChunk.slice(0, 200),
                    fullChunkLength: updatedChunk.length,
                    currentBlockIndex,
                    blockType: currentBlockType,
                  },
                  '[streaming] Enqueuing processed chunk'
                )
                streamContext.fullResponse += updatedChunk
                controller.enqueue(encoder.encode(updatedChunk))

                // Post-process state updates
                if (sourceFormat === 'anthropic' && (isBlockStop || chunkBlockType === 'stop')) {
                  currentBlockType = null // Reset current block type as this block is now stopped
                  currentBlockIndex++ // Prepare index for next block
                  logger.debug(
                    { newIndex: currentBlockIndex },
                    '[streaming] Incrementing index after block stop'
                  )
                }
              }

              if (Array.isArray(transformed)) {
                logger.debug(
                  { arrayLength: transformed.length },
                  '[streaming] Processing array of transformed chunks'
                )
                transformed.forEach((t, idx) => {
                  logger.debug(
                    { idx, chunkPreview: t?.slice?.(0, 100) },
                    '[streaming] Processing array element'
                  )
                  processChunk(t, controller)
                })
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
            // Process any remaining buffered data
            if (buffer.trim()) {
              // Split remaining buffer into events (may have multiple events without \n\n at end)
              const events = buffer.split('\n\n').filter((e) => e.trim())

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
                    streamContext.fullResponse += messageStart
                    controller.enqueue(encoder.encode(messageStart))
                  }

                  // logger.debug(
                  //   {
                  //     from: parsingProvider,
                  //     to: sourceFormat,
                  //     chunkSample: eventWithNewline.slice(0, 200),
                  //   },
                  //   "[streaming] Transform chunk (retry)"
                  // );
                  const transformed = transformStreamChunk(
                    eventWithNewline,
                    parsingProvider,
                    sourceFormat
                  )

                  const processChunk = (
                    chunk: string,
                    controller: TransformStreamDefaultController<Uint8Array>
                  ) => {
                    if (!chunk.trim()) return

                    const chunkBlockType = detectBlockType(chunk)
                    const isBlockStart = chunk.includes('"type":"content_block_start"')
                    const isBlockStop = chunk.includes('"type":"content_block_stop"')

                    if (sourceFormat === 'anthropic') {
                      if (chunkBlockType === 'stop') {
                        let finalChunk = chunk
                        if (currentBlockType !== null) {
                          if (currentBlockType === 'tool_use') {
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

                      if (isBlockStart) {
                        // Early filter for empty text in explicit block start
                        if (chunkBlockType === 'text') {
                          const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                          const allEmpty = textMatch?.every(
                            (m) => m === '"text":""' || m === '"text": ""'
                          )
                          if (allEmpty) {
                            logger.debug('[streaming-flush] Filtering empty text on explicit start')
                            return
                          }
                        }
                        if (currentBlockType !== null) {
                          sendBlockStop(currentBlockIndex, controller)
                          currentBlockIndex++
                        }
                        if (chunkBlockType) currentBlockType = chunkBlockType
                      } else if (chunkBlockType && chunkBlockType !== currentBlockType) {
                        // Early filter for empty text on implicit switch
                        if (chunkBlockType === 'text') {
                          const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                          const allEmpty = textMatch?.every(
                            (m) => m === '"text":""' || m === '"text": ""'
                          )
                          if (allEmpty) {
                            logger.debug(
                              '[streaming-flush] Filtering empty text on implicit switch'
                            )
                            return
                          }
                        }
                        if (currentBlockType !== null) {
                          sendBlockStop(currentBlockIndex, controller)
                          currentBlockIndex++
                        }
                        sendBlockStart(chunkBlockType, currentBlockIndex, controller)
                        currentBlockType = chunkBlockType
                      } else if (currentBlockType === null && chunkBlockType) {
                        // Early filter for empty text on implicit start
                        if (chunkBlockType === 'text') {
                          const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
                          const allEmpty = textMatch?.every(
                            (m) => m === '"text":""' || m === '"text": ""'
                          )
                          if (allEmpty) {
                            logger.debug('[streaming-flush] Filtering empty text on implicit start')
                            return
                          }
                        }
                        sendBlockStart(chunkBlockType, currentBlockIndex, controller)
                        currentBlockType = chunkBlockType
                      }
                    }

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

                    let updatedChunk = chunk
                    try {
                      const lines = chunk.trim().split('\n')
                      const dataLineIndex = lines.findIndex((line) => line.startsWith('data: '))
                      if (dataLineIndex !== -1) {
                        const line = lines[dataLineIndex]
                        if (line) {
                          const dataContent = line.slice(6) // Remove "data: "
                          if (dataContent.trim() !== '[DONE]') {
                            try {
                              const json = JSON.parse(dataContent)
                              if (typeof json === 'object' && json !== null && 'index' in json) {
                                json.index = currentBlockIndex

                                // [READABLE LOGGING] Accumulate text and thinking
                                if (json.type === 'content_block_delta' && json.delta) {
                                  if (typeof json.delta.text === 'string')
                                    streamContext.accumulatedText += json.delta.text
                                  if (typeof json.delta.thinking === 'string')
                                    streamContext.accumulatedThinking += json.delta.thinking
                                } else if (
                                  json.type === 'content_block_start' &&
                                  json.content_block
                                ) {
                                  if (typeof json.content_block.text === 'string')
                                    streamContext.accumulatedText += json.content_block.text
                                  if (typeof json.content_block.thinking === 'string')
                                    streamContext.accumulatedThinking += json.content_block.thinking
                                }

                                lines[dataLineIndex] = `data: ${JSON.stringify(json)}`
                                updatedChunk = `${lines.join('\n')}\n\n`
                              }
                            } catch {
                              // Ignore parse errors here
                            }
                          }
                        }
                      }
                    } catch (e) {
                      logger.warn(
                        { chunk: chunk.slice(0, 100), error: e },
                        '[streaming] Failed to parse/update chunk index safely during flush, falling back to original chunk'
                      )
                    }
                    streamContext.chunkCount++
                    streamContext.fullResponse += updatedChunk
                    controller.enqueue(encoder.encode(updatedChunk))

                    if (
                      sourceFormat === 'anthropic' &&
                      (isBlockStop || chunkBlockType === 'stop')
                    ) {
                      currentBlockType = null
                      currentBlockIndex++
                    }
                  }

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

          streamContext.duration = Date.now() - startTime
          // Helper: sanitize to single line
          const sanitize = (s: string) =>
            s
              .replace(/[\r\n]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          const ri = streamContext.requestInfo || {
            model: 'unknown',
            provider: 'unknown',
            endpoint: '',
            toolsCount: 0,
            bodyLength: 0,
          }
          // SINGLE CONSOLIDATED LOG LINE (Request + Response combined)
          const logMsg = `[Streaming] ${streamContext.reqId} | ${ri.model} (${
            ri.provider
          }) | Tools:${ri.toolsCount} | ReqLen:${ri.bodyLength} | ${
            streamContext.duration
          }ms | Chunks:${streamContext.chunkCount} | Bytes:${streamContext.totalBytes}${
            streamContext.error ? ` | Error: ${sanitize(streamContext.error)}` : ''
          } | Text: "${sanitize(
            streamContext.accumulatedText
          )}" | Thinking: "${sanitize(streamContext.accumulatedThinking)}"`
          logger.info(logMsg)
        },
      })

      // Start pipe (debug only)
      logger.debug(`[Streaming] ${streamContext.reqId} Pipe started`)
      upstreamResponse.body.pipeTo(transformStream.writable).catch((error) => {
        streamContext.error = error instanceof Error ? error.message : String(error)
        logger.error(
          {
            reqId,
            error: streamContext.error,
            stack: error instanceof Error ? error.stack : undefined,
          },
          '[Streaming] Pipe Error - Stream terminated abruptly'
        )
      })

      return new Response(transformStream.readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } // End While

    throw new Error('Max attempts reached')
  } catch (error) {
    const duration = Date.now() - startTime
    const message = error instanceof Error ? error.message : 'Unknown error'
    streamContext.error = message
    // Helper: sanitize to single line
    const sanitize = (s: string) =>
      s
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    // ERROR LOG (Consolidated)
    const ri = streamContext.requestInfo || {
      model: 'unknown',
      provider: 'unknown',
      endpoint: '',
      toolsCount: 0,
      bodyLength: 0,
    }
    const logMsg = `[Streaming] ${streamContext.reqId} | ${ri.model} (${
      ri.provider
    }) | Tools:${ri.toolsCount} | ReqLen:${
      ri.bodyLength
    } | ${duration}ms | ERROR: ${sanitize(message)}`

    logger.error(logMsg)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
