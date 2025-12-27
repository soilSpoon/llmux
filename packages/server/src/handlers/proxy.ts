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

  const targetProvider: ProviderName = targetProviderInput

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

    // Retry loop for rotation
    const maxAttempts = 5
    let attempt = 0
    let lastResponse: Response | undefined
    let currentProvider = targetProvider
    let currentModel = mappedModel
    let effectiveCredentials: Awaited<ReturnType<typeof TokenRefresh.ensureFresh>> | undefined

    while (attempt < maxAttempts) {
      attempt++

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
      }) as { model?: string }

      if (currentModel) {
        transformedRequest.model = currentModel
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

        const credential = effectiveCredentials[0]
        if (!credential) {
          return new Response(
            JSON.stringify({
              error: `No credentials found for ${currentProvider}`,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }
        headers = await currentAuthProvider.getHeaders(credential)
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

      let upstreamResponse: Response
      try {
        upstreamResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(transformedRequest),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Network error'

        // Network error usually worth a generic retry or could use router to fallback if strict
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
          const retryAfterSeconds = parseInt(retryAfterHeader, 10)
          if (!Number.isNaN(retryAfterSeconds)) {
            retryAfterMs = retryAfterSeconds * 1000
          } else {
            // Try parsing as http-date if not integer? (Simple parse for now)
          }
        }

        // Use Router to handle rate limit and find fallback
        if (options.router && currentModel) {
          options.router.handleRateLimit(currentModel, retryAfterMs || undefined)

          // Try to resolve a new model (which might be a fallback)
          options.router.resolveModel(currentModel) // Determine availability state updates
          // Better to pass originalModel to find fallback chain, but if we are already in fallback...
          // Router.resolveModel logic starts from config.modelMapping of requested string.
          // If we are deep in fallback, we need to know the *next* fallback.
          // Our current Router implementation iterates through fallback list of the *mapped* model.
          // But resolveModel(requestedModel) will return the first *available* one.
          // So if we pass the *original* requested model (from options.targetModel or body), it should work.

          const routeQueryModel = originalModel || currentModel
          if (routeQueryModel) {
            const nextRoute = options.router.resolveModel(routeQueryModel)

            // If we found a different provider/model that is available, switch to it
            if (nextRoute.provider !== currentProvider || nextRoute.model !== currentModel) {
              logger.info(
                {
                  from: `${currentProvider}:${currentModel}`,
                  to: `${nextRoute.provider}:${nextRoute.model}`,
                  reason: '429 Fallback',
                },
                'Switching to fallback model'
              )
              currentProvider = nextRoute.provider
              currentModel = nextRoute.model
              // Reset attempt counter or just continue?
              // Continue loop uses attempt limit, maybe we should respect total attempts
              continue
            }
          }
        }

        // Standard backoff if no router or no fallback found
        const delay = Math.min(1000 * 2 ** (attempt - 1), 16000)
        await new Promise((r) => setTimeout(r, delay))

        if (currentAuthProvider && !options.apiKey && currentAuthProvider.rotate) {
          currentAuthProvider.rotate()
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

// Helper types for Opencode Zen modifications
interface OpencodeZenTool {
  input_schema?: Record<string, unknown>
  function?: Record<string, unknown>
  type?: string
  name?: string // Add name and description for easier access
  description?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
