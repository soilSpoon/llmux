import {
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  AuthProviderRegistry,
  TokenRefresh,
} from '@llmux/auth'
import {
  createLogger,
  isValidProviderName,
  type ProviderName,
  transformRequest,
  transformResponse,
} from '@llmux/core'
import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  applyAntigravityAlias,
  fixOpencodeZenBody,
  resolveOpencodeZenProtocol,
  shouldFallbackToDefaultProject,
} from '../providers'
import { buildUpstreamHeaders, getDefaultEndpoint, parseRetryAfterMs } from '../upstream'
import { accountRotationManager } from './account-rotation'
import { applyModelMappingV2 } from './model-mapping'
import {
  buildSignatureSessionKey,
  ensureThinkingSignatures,
  extractConversationKey,
} from './signature-integration'

const logger = createLogger({ service: 'proxy-handler' })

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
  if (!isValidProviderName(format)) {
    throw new Error(`Invalid source format: ${format}`)
  }
  return format
}

export async function handleProxy(request: Request, options: ProxyOptions): Promise<Response> {
  const targetProviderInput = options.targetProvider
  if (!isValidProviderName(targetProviderInput)) {
    return new Response(JSON.stringify({ error: `Invalid provider: ${targetProviderInput}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let targetProvider: ProviderName = targetProviderInput

  try {
    const body = (await request.json()) as {
      model?: string
      stream?: boolean
      thinking?: { type: string; budget_tokens?: number }
    }
    const originalModel = body.model
    const hasThinkingInRequest = body.thinking !== undefined

    // Apply model mapping first to get thinking config
    let mappedModel: string | undefined = originalModel
    // Default: use thinking only if explicitly requested in the original request
    let isThinkingEnabled: boolean | undefined = hasThinkingInRequest
      ? body.thinking?.type === 'enabled'
      : undefined

    if (originalModel) {
      const mappingResult = applyModelMappingV2(originalModel, options.modelMappings)
      mappedModel = mappingResult.model
      // Priority: options.thinking > mappingResult.thinking > original request thinking
      if (options.thinking !== undefined) {
        isThinkingEnabled = options.thinking
      } else if (mappingResult.thinking !== undefined) {
        isThinkingEnabled = mappingResult.thinking
      }
      // If still undefined after mapping, keep original request's thinking setting

      if (mappingResult.provider) {
        if (isValidProviderName(mappingResult.provider)) {
          targetProvider = mappingResult.provider
        } else {
          logger.warn({ provider: mappingResult.provider }, 'Invalid provider in model mapping')
        }
      }
    }

    // Resolve effective provider for opencode-zen
    let effectiveTargetProvider = targetProvider
    if (targetProvider === 'opencode-zen' && (mappedModel || originalModel)) {
      const protocol = resolveOpencodeZenProtocol(mappedModel || originalModel || '')
      if (protocol) {
        effectiveTargetProvider = protocol as ProviderName
      }
    }

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: effectiveTargetProvider,
      // Disable thinking if not explicitly enabled (false or undefined means no thinking)
      thinkingOverride: isThinkingEnabled !== true ? { enabled: false } : undefined,
    }) as { model?: string }

    if (originalModel) {
      if (mappedModel !== originalModel) {
        logger.info(
          {
            originalModel,
            mappedModel,
            targetProvider,
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
      transformedRequest.model = mappedModel
    }

    if (options.targetModel) {
      logger.info(
        { originalModel, targetModel: options.targetModel },
        'Target model override applied'
      )
      transformedRequest.model = options.targetModel
      mappedModel = options.targetModel
    }

    // Log tools information from original request
    const originalTools = (body as { tools?: unknown[] }).tools
    const originalToolsCount = Array.isArray(originalTools) ? originalTools.length : 0

    logger.info(
      {
        sourceFormat: options.sourceFormat,
        targetProvider,
        originalModel,
        finalModel: mappedModel,
        stream: body.stream ?? false,
        toolsCount: originalToolsCount,
      },
      'Proxy request'
    )

    if (Array.isArray(originalTools) && originalTools.length > 0) {
      const toolNames = originalTools.map((t: unknown) => {
        if (typeof t === 'object' && t !== null) {
          if ('name' in t) return (t as { name: string }).name
          if ('function' in t && typeof (t as { function: unknown }).function === 'object') {
            const fn = (t as { function: Record<string, unknown> }).function
            if ('name' in fn) return fn.name as string
          }
        }
        return 'unknown'
      })
      logger.debug(
        {
          toolNames,
          toolsCount: originalToolsCount,
        },
        '[Proxy] Original tools in request'
      )
    }

    // Retry loop for rotation
    const MAX_ATTEMPTS = 10
    let attempt = 0
    let lastResponse: Response | undefined
    let currentProvider = targetProvider
    let currentModel = mappedModel
    let effectiveCredentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined
    let accountIndex = 0
    let overrideProjectId: string | null = null // For Project ID Fallback

    while (attempt < MAX_ATTEMPTS) {
      attempt++

      logger.debug(
        {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          provider: currentProvider,
          model: currentModel,
        },
        '[proxy] Starting attempt'
      )

      // Re-evaluate AuthProvider based on currentProvider (which might have changed due to fallback)
      const currentAuthProvider = AuthProviderRegistry.get(currentProvider)

      // Re-determine effective target provider for transformation logic
      let currentEffectiveProvider = currentProvider
      if (currentProvider === 'opencode-zen' && currentModel) {
        const protocol = resolveOpencodeZenProtocol(currentModel)
        if (protocol) {
          currentEffectiveProvider = protocol as ProviderName
        }
      }

      // Re-transform request for the current provider
      const transformedRequest = transformRequest(body, {
        from: formatToProvider(options.sourceFormat),
        to: currentEffectiveProvider,
        // Disable thinking if not explicitly enabled (false or undefined means no thinking)
        thinkingOverride: isThinkingEnabled !== true ? { enabled: false } : undefined,
      }) as { model?: string; tools?: unknown[] }

      if (currentModel) {
        transformedRequest.model = currentModel
      }

      // Apply Project ID override if set (for License Error Fallback)
      if (overrideProjectId && currentProvider === 'antigravity') {
        ;(transformedRequest as Record<string, unknown>).project = overrideProjectId
        logger.debug({ overrideProjectId }, '[proxy] Applied Project ID override')
      }

      // Log transformed request tools inside retry loop
      const transformedTools = transformedRequest.tools
      const transformedToolsCount = Array.isArray(transformedTools) ? transformedTools.length : 0

      if (transformedToolsCount > 0 && Array.isArray(transformedTools)) {
        const transformedToolNames = transformedTools.map((t: unknown) => {
          if (typeof t === 'object' && t !== null) {
            if ('name' in t) return (t as { name: string }).name
            if ('function' in t && typeof (t as { function: unknown }).function === 'object') {
              const fn = (t as { function: Record<string, unknown> }).function
              if ('name' in fn) return fn.name as string
            }
          }
          return 'unknown'
        })
        logger.debug(
          {
            toolNames: transformedToolNames,
            toolsCount: transformedToolsCount,
            sourceFormat: options.sourceFormat,
            targetFormat: currentEffectiveProvider,
          },
          '[Proxy] Transformed tools in request'
        )
      }

      let endpoint = ''
      let headers: Record<string, string> = {}

      if (currentAuthProvider && (!options.apiKey || options.apiKey === 'dummy')) {
        endpoint = currentAuthProvider.getEndpoint(currentModel || 'gemini-pro')

        try {
          effectiveCredentials = await TokenRefresh.ensureFresh(currentProvider)
        } catch {
          return new Response(
            JSON.stringify({
              error: `No credentials found for ${currentProvider}`,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }

        accountIndex = accountRotationManager.getNextAvailable(
          currentProvider,
          effectiveCredentials || []
        )
        const credential = effectiveCredentials?.[accountIndex]
        if (!credential) {
          return new Response(
            JSON.stringify({
              error: `No credentials found for ${currentProvider}`,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }
        headers = await currentAuthProvider.getHeaders(credential, {
          model: currentModel || 'gemini-pro',
        })
      } else {
        let url = getDefaultEndpoint(currentProvider, { streaming: false })

        // Special case for Opencode Zen
        if (currentProvider === 'opencode-zen' && effectiveTargetProvider === 'openai') {
          url = 'https://opencode.ai/zen/v1/chat/completions'
        }

        if (!url) {
          return new Response(JSON.stringify({ error: `Unknown provider: ${currentProvider}` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        endpoint = url
        headers = buildUpstreamHeaders(currentProvider, options.apiKey, {
          fromProtocol: effectiveTargetProvider,
        })
      }

      // Antigravity Endpoint Fallback Logic
      // Always use streaming endpoint - generateContent doesn't support Claude models
      if (currentProvider === 'antigravity') {
        const fallbackIndex = (attempt - 1) % ANTIGRAVITY_ENDPOINT_FALLBACKS.length
        const baseEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[fallbackIndex]
        // Always use streaming endpoint, even for non-streaming requests
        // We'll buffer the SSE response and convert to JSON for non-streaming
        endpoint = `${baseEndpoint}${ANTIGRAVITY_API_PATH_STREAM}`

        logger.debug(
          {
            attempt,
            endpoint,
            fallbackIndex,
            baseEndpoint,
            originalStreaming: !!body.stream,
            usingStreamEndpoint: true,
          },
          '[proxy] Using Antigravity streaming endpoint (always)'
        )
      }

      // Forward anthropic-beta header handling ...
      const anthropicBeta = request.headers.get('anthropic-beta')
      if (anthropicBeta) {
        // ... (existing logic for beta headers, could be extracted but keeping inline for now)
        if (
          currentProvider === 'opencode-zen' &&
          anthropicBeta.includes('fine-grained-tool-streaming')
        ) {
          const betas = anthropicBeta
            .split(',')
            .map((s) => s.trim())
            .filter((s) => !s.startsWith('fine-grained-tool-streaming'))
          if (betas.length > 0) {
            headers['anthropic-beta'] = betas.join(',')
          }
        } else {
          headers['anthropic-beta'] = anthropicBeta
        }
      }

      // Update model in body if it changed
      if (currentModel && transformedRequest.model !== currentModel) {
        transformedRequest.model = currentModel
      }

      // Apply model alias for Antigravity (e.g., gemini-claude-opus-4-5-thinking -> claude-opus-4-5-thinking)
      if (currentProvider === 'antigravity' && transformedRequest.model) {
        const aliasedModel = applyAntigravityAlias(transformedRequest.model)
        if (aliasedModel !== transformedRequest.model) {
          logger.debug(
            { originalModel: transformedRequest.model, aliasedModel },
            '[proxy] Applied Antigravity model alias'
          )
          transformedRequest.model = aliasedModel
        }
      }

      // Apply thinking signature restoration for Claude thinking models
      // (Same logic as streaming.ts to ensure signatures are properly handled)
      if (
        currentProvider === 'antigravity' &&
        currentModel &&
        (currentModel.includes('thinking') || currentModel.includes('claude'))
      ) {
        const conversationKey = extractConversationKey(body)
        const signatureSessionKey = buildSignatureSessionKey(conversationKey)
        logger.debug(
          {
            model: currentModel,
            provider: currentProvider,
            conversationKey,
            sessionKey: signatureSessionKey?.slice(0, 50),
          },
          '[proxy] Preparing signature restoration for thinking model'
        )
        ensureThinkingSignatures(transformedRequest, signatureSessionKey, currentModel)
        logger.debug(
          { sessionKey: signatureSessionKey?.slice(0, 50) },
          '[proxy] ensureThinkingSignatures completed'
        )
      }

      // Strip unsupported beta fields for Opencode-Zen
      if (currentProvider === 'opencode-zen') {
        fixOpencodeZenBody(transformedRequest, { thinkingEnabled: isThinkingEnabled })
      }

      // DEBUG: Log request details before sending
      const bodyToLog = JSON.stringify(transformedRequest)
      logger.debug(
        {
          attempt,
          endpoint,
          requestHeaders: Object.keys(headers).reduce(
            (acc, key) => {
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
        '[proxy] Sending upstream request'
      )

      let upstreamResponse: Response
      try {
        upstreamResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(transformedRequest),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Network error'

        logger.warn(
          { error: message, attempt, maxAttempts: MAX_ATTEMPTS },
          '[proxy] Upstream fetch failed'
        )

        // Network error: use exponential backoff
        if (attempt < MAX_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000)
          logger.debug({ attempt, delayMs: delay }, '[proxy] Retrying after network error')
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        return new Response(JSON.stringify({ error: message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // DEBUG: Log response headers
      logger.debug(
        {
          attempt,
          status: upstreamResponse.status,
          responseHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
        },
        '[proxy] Received upstream response'
      )

      lastResponse = upstreamResponse

      if (upstreamResponse.status === 429) {
        let bodyText = ''
        try {
          bodyText = await upstreamResponse.clone().text()
        } catch {}

        const parsedRetryAfter = parseRetryAfterMs(upstreamResponse, bodyText)
        const retryAfterMs = parsedRetryAfter || 30000

        accountRotationManager.markRateLimited(currentProvider, accountIndex, retryAfterMs)

        logger.warn(
          {
            attempt,
            retryAfterMs,
            provider: currentProvider,
            model: currentModel,
            accountIndex,
          },
          '[proxy] Rate limited (429)'
        )

        // Use Router to handle rate limit and find fallback
        if (options.router && currentModel) {
          options.router.handleRateLimit(currentModel, retryAfterMs || undefined)

          // Trigger model fallback if ALL accounts are rate limited
          if (
            accountRotationManager.areAllRateLimited(currentProvider, effectiveCredentials || [])
          ) {
            const routeQueryModel = originalModel || currentModel
            if (routeQueryModel) {
              const nextRoute = options.router.resolveModel(routeQueryModel)

              // If we found a different provider/model that is available, switch to it
              if (nextRoute.provider !== currentProvider || nextRoute.model !== currentModel) {
                logger.info(
                  {
                    from: `${currentProvider}:${currentModel}`,
                    to: `${nextRoute.provider}:${nextRoute.model}`,
                    reason: '429 Fallback (All Accounts Limited)',
                  },
                  '[proxy] Switching to fallback model'
                )
                currentProvider = nextRoute.provider
                currentModel = nextRoute.model
                continue
              }
            }
          }
        }

        // If not all accounts are limited, we can rotate immediately (delay=0).
        // If all ARE limited but we couldn't fallback (end of chain), we must wait.
        // Cap wait at 30s (default cooldown) to avoid hanging forever.
        const isAllLimited = accountRotationManager.areAllRateLimited(
          currentProvider,
          effectiveCredentials || []
        )
        const delay = isAllLimited ? Math.min(retryAfterMs, 30000) : 0

        logger.debug({ attempt, delayMs: delay }, '[proxy] Waiting before retry')
        await new Promise((r) => setTimeout(r, delay))

        continue
      }

      // Antigravity Project ID Fallback for License Error (#3501)
      if (
        currentProvider === 'antigravity' &&
        !upstreamResponse.ok &&
        (upstreamResponse.status === 403 || upstreamResponse.status === 400) &&
        attempt < MAX_ATTEMPTS
      ) {
        let errorBody = ''
        try {
          errorBody = await upstreamResponse.clone().text()
        } catch {
          errorBody = ''
        }

        const currentProject = (transformedRequest as Record<string, unknown>).project as
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
              attempt,
              currentProject,
              defaultProject: ANTIGRAVITY_DEFAULT_PROJECT_ID,
            },
            '[proxy] License error detected. Switching to default project ID and retrying.'
          )
          overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID

          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
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

    // Handle SSE response for Antigravity non-streaming requests
    // We always use streaming endpoint, so need to buffer SSE and convert to JSON
    if (contentType.includes('text/event-stream') && !body.stream) {
      logger.debug('[proxy] Buffering SSE response for non-streaming request')

      const reader = lastResponse.body?.getReader()
      if (!reader) {
        return new Response(JSON.stringify({ error: 'No response body' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let finalResponse: Record<string, unknown> | null = null
      let accumulatedParts: unknown[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data) as { response?: Record<string, unknown> }
            const chunk = (parsed.response || parsed) as Record<string, unknown>

            if (!finalResponse) {
              finalResponse = chunk
              const candidates = chunk.candidates as
                | Array<{ content?: { parts?: unknown[] } }>
                | undefined
              if (candidates?.[0]?.content?.parts) {
                accumulatedParts = [...candidates[0].content.parts]
              }
            } else {
              const candidates = chunk.candidates as
                | Array<{
                    content?: { parts?: unknown[] }
                    finishReason?: string
                  }>
                | undefined
              if (candidates?.[0]?.content?.parts) {
                accumulatedParts = [...accumulatedParts, ...candidates[0].content.parts]
              }
              if (candidates?.[0]?.finishReason) {
                const finalCandidates = finalResponse.candidates as
                  | Array<{ finishReason?: string }>
                  | undefined
                if (finalCandidates?.[0]) {
                  finalCandidates[0].finishReason = candidates[0].finishReason
                }
              }
              if (chunk.usageMetadata) {
                finalResponse.usageMetadata = chunk.usageMetadata
              }
            }
          } catch {
            // Ignore parse errors for partial chunks
          }
        }
      }

      if (finalResponse && accumulatedParts.length > 0) {
        const candidates = finalResponse.candidates as
          | Array<{ content?: { parts?: unknown[] } }>
          | undefined
        if (candidates?.[0]?.content) {
          candidates[0].content.parts = accumulatedParts
        }
      }

      if (!finalResponse) {
        return new Response(JSON.stringify({ error: 'Failed to parse SSE response' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      logger.debug({ responseKeys: Object.keys(finalResponse) }, '[proxy] SSE buffered to JSON')

      // Wrap response for Antigravity format (transform expects {response: {...}})
      const wrappedResponse = { response: finalResponse }

      const transformedResponse = transformResponse(wrappedResponse, {
        from: targetProvider,
        to: formatToProvider(options.sourceFormat),
      })

      return new Response(JSON.stringify(transformedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!contentType.includes('application/json')) {
      const text = await lastResponse.text()
      return new Response(JSON.stringify({ error: text || 'Non-JSON response from upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const upstreamBody = await lastResponse.json()

    // Log tool_calls in response
    const upstreamToolCalls = (
      upstreamBody as {
        tool_calls?: unknown[]
        content?: unknown[]
      }
    ).tool_calls
    const upstreamContent = (upstreamBody as { content?: unknown[] }).content

    let toolCallNames: string[] = []
    if (Array.isArray(upstreamToolCalls) && upstreamToolCalls.length > 0) {
      toolCallNames = upstreamToolCalls.map((tc: unknown) => {
        if (typeof tc === 'object' && tc !== null && 'function' in tc) {
          const fn = (tc as { function: { name: string } }).function
          return fn.name
        }
        return 'unknown'
      })
      logger.debug(
        {
          toolCallNames,
          count: toolCallNames.length,
        },
        '[Proxy] Tool calls in upstream response'
      )
    } else if (Array.isArray(upstreamContent)) {
      // Anthropic format: tool_use blocks in content
      const toolUses = upstreamContent.filter(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'type' in c &&
          (c as { type: string }).type === 'tool_use'
      )
      if (toolUses.length > 0) {
        toolCallNames = toolUses.map((c: unknown) => (c as { name: string }).name || 'unknown')
        logger.debug(
          {
            toolCallNames,
            count: toolCallNames.length,
          },
          '[Proxy] Tool use blocks in upstream content'
        )
      }
    }

    const transformedResponse = transformResponse(upstreamBody, {
      from: targetProvider,
      to: formatToProvider(options.sourceFormat),
    })

    // Log transformed tool_calls
    const transformedToolCalls = (
      transformedResponse as {
        tool_calls?: unknown[]
        content?: unknown[]
      }
    ).tool_calls
    const transformedContent = (transformedResponse as { content?: unknown[] }).content

    let transformedToolNames: string[] = []
    if (Array.isArray(transformedToolCalls) && transformedToolCalls.length > 0) {
      transformedToolNames = transformedToolCalls.map((tc: unknown) => {
        if (typeof tc === 'object' && tc !== null && 'function' in tc) {
          const fn = (tc as { function: { name: string } }).function
          return fn.name
        }
        return 'unknown'
      })
    } else if (Array.isArray(transformedContent)) {
      const toolUses = transformedContent.filter(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'type' in c &&
          (c as { type: string }).type === 'tool_use'
      )
      if (toolUses.length > 0) {
        transformedToolNames = toolUses.map(
          (c: unknown) => (c as { name: string }).name || 'unknown'
        )
      }
    }

    if (transformedToolNames.length > 0) {
      logger.info(
        {
          toolCallNames: transformedToolNames,
          count: transformedToolNames.length,
        },
        '[Proxy] Tool calls in transformed response'
      )
    }

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
