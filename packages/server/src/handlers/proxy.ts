import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_HEADERS,
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
import { accountRotationManager } from './account-rotation'
import { applyModelMappingV2 } from './model-mapping'
import { parseRetryAfterMs } from './streaming'

const logger = createLogger({ service: 'proxy-handler' })

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
  antigravity: 'https://Daily-Cloudcode-Pa.Sandbox.Googleapis.Com/V1internal',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
}

function formatToProvider(format: RequestFormat): ProviderName {
  if (!isValidProviderName(format)) {
    throw new Error(`Invalid source format: ${format}`)
  }
  return format
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
    const body = (await request.json()) as { model?: string; stream?: boolean }
    const originalModel = body.model

    // Resolve effective provider for opencode-zen
    let effectiveTargetProvider = targetProvider
    if (targetProvider === 'opencode-zen' && originalModel) {
      if (originalModel.includes('claude')) {
        // Claude models use Anthropic format (v1/messages)
        effectiveTargetProvider = 'anthropic' as ProviderName
      } else if (
        originalModel.startsWith('gpt-5') ||
        originalModel.startsWith('glm-') ||
        originalModel.startsWith('qwen') ||
        originalModel.startsWith('kimi') ||
        originalModel.startsWith('grok') ||
        originalModel === 'big-pickle'
      ) {
        // OpenAI-compatible models use chat completions format (including GLM-4.6, GLM-4.7-free)
        effectiveTargetProvider = 'openai' as ProviderName
      } else if (originalModel.startsWith('gemini')) {
        effectiveTargetProvider = 'gemini' as ProviderName
      }
    }

    const transformedRequest = transformRequest(body, {
      from: formatToProvider(options.sourceFormat),
      to: effectiveTargetProvider,
    }) as { model?: string }

    let mappedModel: string | undefined = originalModel

    if (originalModel) {
      const mappingResult = applyModelMappingV2(originalModel, options.modelMappings)
      const appliedMapping = mappingResult.model

      if (mappingResult.provider) {
        if (isValidProviderName(mappingResult.provider)) {
          targetProvider = mappingResult.provider
          // Also update effectiveTargetProvider if we switched provider?
          // The code below recalculates things inside the retry loop based on `currentProvider`.
          // `currentProvider` is initialized to `targetProvider`.
          // So updating `targetProvider` here is correct for the loop.
        } else {
          logger.warn({ provider: mappingResult.provider }, 'Invalid provider in model mapping')
        }
      }

      if (appliedMapping !== originalModel) {
        logger.info(
          {
            originalModel,
            mappedModel: appliedMapping,
            targetProvider, // Log the (possibly updated) provider
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
        if (currentModel.includes('claude')) {
          currentEffectiveProvider = 'anthropic' as ProviderName
        } else if (
          currentModel.startsWith('gpt-5') ||
          currentModel.startsWith('glm-') ||
          currentModel.startsWith('qwen') ||
          currentModel.startsWith('kimi') ||
          currentModel.startsWith('grok') ||
          currentModel === 'big-pickle'
        ) {
          currentEffectiveProvider = 'openai' as ProviderName
        } else if (currentModel.startsWith('gemini')) {
          currentEffectiveProvider = 'gemini' as ProviderName
        }
      }

      // Re-transform request for the current provider
      const transformedRequest = transformRequest(body, {
        from: formatToProvider(options.sourceFormat),
        to: currentEffectiveProvider,
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
        let url = PROVIDER_ENDPOINTS[currentProvider]

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
        headers = buildHeaders(currentProvider, options.apiKey, effectiveTargetProvider)
      }

      // Antigravity Endpoint Fallback Logic
      if (currentProvider === 'antigravity') {
        const fallbackIndex = (attempt - 1) % ANTIGRAVITY_ENDPOINT_FALLBACKS.length
        const baseEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[fallbackIndex]
        const apiPath = body.stream ? ANTIGRAVITY_API_PATH_STREAM : ANTIGRAVITY_API_PATH_GENERATE
        endpoint = `${baseEndpoint}${apiPath}`

        logger.debug(
          {
            attempt,
            endpoint,
            fallbackIndex,
            baseEndpoint,
            isStreaming: !!body.stream,
          },
          '[proxy] Using Antigravity fallback endpoint'
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

      // Strip unsupported beta fields for Opencode-Zen
      if (currentProvider === 'opencode-zen') {
        fixOpencodeZenBody(transformedRequest)
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

        const retryAfterMs = parseRetryAfterMs(upstreamResponse, bodyText)

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

          // Only trigger model fallback if ALL accounts are rate limited
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

        // Wait based on retryAfterMs (max 5 seconds as requested)
        const delay = Math.min(retryAfterMs, 5000)

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

        if (
          errorBody.includes('#3501') ||
          (errorBody.includes('PERMISSION_DENIED') && errorBody.includes('license'))
        ) {
          const currentProject = (transformedRequest as Record<string, unknown>).project
          if (currentProject !== ANTIGRAVITY_DEFAULT_PROJECT_ID) {
            logger.warn(
              {
                attempt,
                currentProject,
                defaultProject: ANTIGRAVITY_DEFAULT_PROJECT_ID,
              },
              '[proxy] License error detected. Switching to default project ID and retrying.'
            )
            // Set override flag instead of modifying transformedRequest directly
            overrideProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID

            // Wait briefly before retry
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
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

// Helper types for Opencode Zen modifications
interface OpencodeZenTool {
  input_schema?: Record<string, unknown>
  function?: Record<string, unknown>
  type?: string
  name?: string // Add name and description for easier access
  description?: string
}

function fixOpencodeZenBody(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') return

  // 1. Remove unsupported fields
  // stripBetaFields will handle cache_control recursively now?
  // Or do we keep explicit logic?
  // Let's reuse stripBetaFields logic if possible or just implement robustly here.

  // Recursively strip fields
  stripBetaFields(body)

  // 2. Fix tools format (Anthropic input_schema -> OpenAI function)
  // Check if tools exist and if they look like Anthropic tools (have input_schema)
  const tools = body.tools as unknown[]

  if (Array.isArray(tools) && tools.length > 0) {
    const firstTool = tools[0] as OpencodeZenTool
    if (firstTool.input_schema) {
      // Convert Anthropic tools to OpenAI format
      body.tools = tools.map((t) => {
        const tool = t as OpencodeZenTool
        return {
          type: 'function',
          function: {
            name: tool.name, // Name usually exists on both?
            description: tool.description,
            parameters: tool.input_schema,
          },
        }
      })
    }
  }
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
