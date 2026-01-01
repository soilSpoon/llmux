import {
  AntigravityProvider as AntigravityAuthProvider,
  AuthProviderRegistry,
  GithubCopilotProvider,
  OpenAIWebProvider,
  OpencodeZenProvider as OpencodeZenAuthProvider,
} from '@llmux/auth'
import type { ProviderName } from '@llmux/core' // Ensure ProviderName is imported
import {
  AnthropicProvider,
  AntigravityProvider,
  OpenAIWebProvider as CoreOpenAIWebProvider,
  createLogger,
  GeminiProvider,
  getRegisteredProviders,
  OpenAIProvider,
  OpencodeZenProvider,
  registerProvider,
} from '@llmux/core'
import { createManagementRoutes } from './amp/management'
import { createAmpRoutes, type ProviderHandlers } from './amp/routes'
import type { CredentialProvider } from './auth'
import type { RoutingConfig } from './config'
import { CooldownManager } from './cooldown'
import { FallbackHandler, type ProviderChecker } from './handlers/fallback'
import { handleHealth } from './handlers/health'
import { parseModelMapping } from './handlers/model-mapping' // Import mapping parser
import { handleModels } from './handlers/models'
import { handleProxy, type ProxyOptions } from './handlers/proxy'
import { handleResponses, type ResponsesOptions } from './handlers/responses'
import { handleStreamingProxy } from './handlers/streaming'
import { corsMiddleware } from './middleware/cors'
import { detectFormat, type RequestFormat } from './middleware/format'
import { createRouter, type Route } from './router' // Keep the HTTP router import
import { Router } from './routing' // Add the model router import
import { createUpstreamProxy, type UpstreamProxy } from './upstream/proxy'

const logger = createLogger({ service: 'server' })

// Register core transformation providers on module load
registerProvider(new OpenAIProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
registerProvider(new OpencodeZenProvider())
registerProvider(new CoreOpenAIWebProvider())

// Register auth providers on module load
AuthProviderRegistry.register(OpencodeZenAuthProvider)
AuthProviderRegistry.register(OpenAIWebProvider)
AuthProviderRegistry.register(GithubCopilotProvider)
AuthProviderRegistry.register(AntigravityAuthProvider)

export interface AmpConfig {
  handlers: ProviderHandlers
  upstreamUrl?: string
  upstreamApiKey?: string
  providerChecker?: ProviderChecker
  enableManagementRoutes?: boolean
  restrictManagementToLocalhost?: boolean
  modelMappings?: Array<{ from: string; to: string | string[] }>
}

export interface ServerConfig {
  port: number
  hostname: string
  corsOrigins?: string[]
  amp?: AmpConfig
  credentialProvider?: CredentialProvider
}

export interface LlmuxServer {
  port: number
  hostname: string
  stop(): Promise<void>
}

const defaultConfig: ServerConfig = {
  port: 8743,
  hostname: 'localhost',
}

export function createServer(config?: Partial<ServerConfig>): LlmuxServer {
  const mergedConfig = { ...defaultConfig, ...config }

  return {
    port: mergedConfig.port,
    hostname: mergedConfig.hostname,
    stop: async () => {},
  }
}

async function handleProviders(_request: Request): Promise<Response> {
  const providers = getRegisteredProviders()
  return new Response(JSON.stringify({ providers }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface RequestBody {
  stream?: boolean
}

interface BuildProxyOptionsParams {
  request: Request
  body: RequestBody
  defaultTargetProvider?: string
  overrideSourceFormat?: RequestFormat
  modelMappings?: AmpConfig['modelMappings']
  router?: Router
}

function inferProvider(model: string): ProviderName {
  // Check for explicit provider suffix first (just in case passed here, though mostly handled by caller)
  if (model.includes(':')) {
    const parts = model.split(':')
    const providerCandidate = parts[parts.length - 1] ?? ''
    if (
      ['openai', 'anthropic', 'gemini', 'antigravity', 'opencode-zen', 'openai-web'].includes(
        providerCandidate
      )
    ) {
      return providerCandidate as ProviderName
    }
  }

  // Antigravity specific definitions
  if (model.startsWith('gemini-claude-') || model.includes('antigravity')) {
    return 'antigravity'
  }

  // Opencode Zen specific definitions
  if (
    model === 'glm-4.7-free' ||
    model.startsWith('glm-') || // Generally GLM models are Opencode Zen/OpenAI compatible but usually Zen provided
    model === 'big-pickle' ||
    model.startsWith('qwen-') ||
    model.startsWith('kimi-') ||
    model.startsWith('grok-')
  ) {
    return 'opencode-zen'
  }

  if (model.includes('claude')) return 'anthropic'
  // Check openai-web models FIRST (more specific patterns)
  if (model.startsWith('gpt-5') || model.includes('codex')) return 'openai-web'
  // Then check generic openai patterns
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  )
    return 'openai'
  if (model.startsWith('gemini')) return 'gemini'
  return 'openai' // Default fallback
}

function buildProxyOptions({
  request,
  body,
  defaultTargetProvider = 'anthropic',
  overrideSourceFormat,
  modelMappings,
  router,
}: BuildProxyOptionsParams): ProxyOptions {
  const sourceFormat = overrideSourceFormat ?? detectFormat(body)
  let targetProvider = request.headers.get('X-Target-Provider')

  // Automatic provider routing based on model
  const bodyData = body as Record<string, unknown>
  const bodyModel = bodyData.model as string | undefined
  if (!targetProvider && bodyModel) {
    if (bodyModel === 'glm-4.7-free' || bodyModel === 'glm-4.6') {
      targetProvider = 'opencode-zen'
    }
  }

  targetProvider = targetProvider ?? defaultTargetProvider
  const targetModel = request.headers.get('X-Target-Model') ?? undefined
  const apiKey = request.headers.get('X-API-Key') ?? undefined

  return {
    sourceFormat,
    targetProvider,
    targetModel,
    apiKey,
    modelMappings,
    router,
  }
}

/**
 * /v1/chat/completions endpoint handler
 *
 * OpenAI SDK compatibility endpoint. Auto-detects request format from body.
 * Default routes to OpenAI, but can override via X-Target-Provider header.
 *
 * Supports:
 * - OpenAI format (auto-detected)
 * - All target providers (openai, anthropic, gemini, antigravity)
 * - Streaming and non-streaming
 * - Model mapping and override via X-Target-Model
 */
function createChatCompletionsHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createChatCompletionsHandler',
      },
      'Handling request'
    )
    const body = (await request.clone().json()) as RequestBody
    const options = buildProxyOptions({ request, body, modelMappings, router })

    if (body.stream) {
      return handleStreamingProxy(request, options)
    }
    return handleProxy(request, options)
  }
}

/**
 * /v1/messages endpoint handler (and /messages alias)
 *
 * Anthropic SDK compatibility endpoint. Enforces Anthropic format input.
 * Default routes to Anthropic, but can override via X-Target-Provider header.
 *
 * Format behavior:
 * - Always parses input as Anthropic (checks for 'system' field)
 * - Allows override to other providers via X-Target-Provider header
 * - Compatible with @ai-sdk/anthropic createAnthropic()
 *
 * Supports:
 * - Anthropic format (enforced)
 * - All target providers (openai, anthropic, gemini, antigravity)
 * - Streaming and non-streaming
 * - Model mapping and override via X-Target-Model
 */
function createMessagesHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createMessagesHandler',
      },
      'Handling request'
    )
    const body = (await request.clone().json()) as RequestBody

    // /v1/messages endpoint: Anthropic-style messages format
    // Always parse request as Anthropic format
    // For target provider: use header if provided, otherwise default to 'anthropic'
    const targetProvider = request.headers.get('X-Target-Provider') ?? 'anthropic'

    const options = buildProxyOptions({
      request,
      body,
      defaultTargetProvider: targetProvider,
      overrideSourceFormat: 'anthropic', // Always parse incoming as Anthropic
      modelMappings,
      router,
    })

    if (body.stream) {
      return handleStreamingProxy(request, options)
    }
    return handleProxy(request, options)
  }
}

/**
 * /v1/generateContent endpoint handler
 *
 * Google Gemini API compatibility endpoint. Auto-detects Gemini format from body.
 * Default routes to Gemini, but can override via X-Target-Provider header.
 *
 * Format behavior:
 * - Auto-detects Gemini format (checks for 'contents' array)
 * - Allows override to other providers via X-Target-Provider header
 *
 * Supports:
 * - Gemini format (auto-detected)
 * - All target providers (openai, anthropic, gemini, antigravity)
 * - Streaming and non-streaming
 * - Model mapping and override via X-Target-Model
 */
function createGenerateContentHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createGenerateContentHandler',
      },
      'Handling request'
    )
    const body = (await request.clone().json()) as RequestBody
    const options = buildProxyOptions({ request, body, modelMappings, router })

    if (body.stream) {
      return handleStreamingProxy(request, options)
    }
    return handleProxy(request, options)
  }
}

/**
 * /v1/auto endpoint handler
 *
 * Universal proxy endpoint with automatic format detection.
 * Routes requests to matching provider based on detected format.
 *
 * Format behavior:
 * - Auto-detects format from request body (OpenAI, Anthropic, Gemini, Antigravity)
 * - Defaults to detected provider, but allows override via X-Target-Provider
 * - Generic proxy when client doesn't know format at request time
 *
 * Supports:
 * - All input formats (auto-detected)
 * - All target providers (routing to detected format by default)
 * - Streaming and non-streaming
 * - Model mapping and override via X-Target-Model
 */
function createAutoDetectHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createAutoDetectHandler',
      },
      'Handling request'
    )
    const body = (await request.clone().json()) as RequestBody

    // Auto-detect format from request body, allow override via X-Target-Provider header
    const detectedFormat = detectFormat(body)

    const options = buildProxyOptions({
      request,
      body,
      defaultTargetProvider: detectedFormat, // Route to provider matching request format
      overrideSourceFormat: detectedFormat, // Source is whatever format was detected
      modelMappings,
      router,
    })

    if (body.stream) {
      return handleStreamingProxy(request, options)
    }
    return handleProxy(request, options)
  }
}

/**
 * /v1/proxy endpoint handler
 *
 * Explicit provider routing via required header.
 * Use when you need full control over request routing.
 *
 * Format behavior:
 * - Auto-detects input format from request body
 * - Routes to provider specified in X-Target-Provider header (required)
 * - Returns 400 if X-Target-Provider header is missing
 *
 * Supports:
 * - All input formats (auto-detected)
 * - All target providers (explicit via header)
 * - Streaming and non-streaming
 * - Model mapping and override via X-Target-Model
 */
function createExplicitProxyHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createExplicitProxyHandler',
      },
      'Handling request'
    )
    const targetProvider = request.headers.get('X-Target-Provider')
    if (!targetProvider) {
      return new Response(JSON.stringify({ error: 'X-Target-Provider header required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = (await request.clone().json()) as RequestBody
    const options = buildProxyOptions({
      request,
      body,
      defaultTargetProvider: targetProvider,
      modelMappings,
      router,
    })

    if (body.stream) {
      return handleStreamingProxy(request, options)
    }
    return handleProxy(request, options)
  }
}

/**
 * /v1/responses endpoint handler
 *
 * OpenAI Responses API compatible endpoint.
 * Accepts OpenAI format and normalizes responses to OpenAI Responses API format.
 *
 * Format behavior:
 * - Input: OpenAI format (standard chat completions request)
 * - Output: OpenAI Responses API format (structured response with reasoning, etc.)
 * - Supports all target providers with automatic response transformation
 * - Model-based provider detection if X-Target-Provider not specified
 *
 * Supports:
 * - OpenAI input format (auto-detected)
 * - All target providers (via header, model-based detection, or default openai)
 * - Streaming and non-streaming responses
 * - Antigravity streaming endpoint auto-selection
 * - Provider-based response transformation
 */
function createResponsesHandler(
  modelMappings?: AmpConfig['modelMappings'],
  credentialProvider?: CredentialProvider
) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createResponsesHandler',
      },
      'Handling request'
    )
    const targetProvider = request.headers.get('X-Target-Provider') ?? undefined
    const targetModel = request.headers.get('X-Target-Model') ?? undefined
    const apiKey = request.headers.get('X-API-Key') ?? undefined

    const options: ResponsesOptions = {
      targetProvider,
      targetModel,
      apiKey,
      modelMappings,
      credentialProvider,
      // Responses handler doesn't support Router yet in Options interface?
      // Check ResponsesOptions definition.
      // If not, we might not be able to pass it easily without refactoring ResponsesHandler too.
      // For now, let's omit router injection here or TODO it.
    }

    return handleResponses(request, options)
  }
}

/**
 * /backend-api/codex/responses endpoint handler
 *
 * Codex CLI compatible endpoint. Forces openai-web provider.
 * This endpoint is used by Codex CLI and other clients expecting
 * the ChatGPT backend API format.
 */
function createCodexResponsesHandler(
  modelMappings?: AmpConfig['modelMappings'],
  credentialProvider?: CredentialProvider
) {
  return async (request: Request): Promise<Response> => {
    logger.debug(
      {
        path: request.url,
        method: request.method,
        handler: 'createCodexResponsesHandler',
      },
      'Handling Codex request'
    )

    const options: ResponsesOptions = {
      targetProvider: 'openai-web',
      modelMappings,
      credentialProvider,
    }

    return handleResponses(request, options)
  }
}

interface RouteOptions {
  credentialProvider?: CredentialProvider
  modelMappings?: AmpConfig['modelMappings']
  router?: Router
}

function createDefaultRoutes(options: RouteOptions): Route[] {
  const modelsHandler = (req: Request) =>
    handleModels(req, {
      credentialProvider: options.credentialProvider,
      modelMappings: options.modelMappings,
    })

  const chatCompletionsHandler = createChatCompletionsHandler(options.modelMappings, options.router)
  const messagesHandler = createMessagesHandler(options.modelMappings, options.router)
  const generateContentHandler = createGenerateContentHandler(options.modelMappings, options.router)
  const autoDetectHandler = createAutoDetectHandler(options.modelMappings, options.router)
  const explicitProxyHandler = createExplicitProxyHandler(options.modelMappings, options.router)
  const responsesHandler = createResponsesHandler(options.modelMappings, options.credentialProvider)

  return [
    // Utility endpoints
    { method: 'GET', path: '/health', handler: handleHealth },
    { method: 'GET', path: '/providers', handler: handleProviders },
    { method: 'GET', path: '/models', handler: modelsHandler },

    // Provider-specific endpoints (format auto-detected)
    {
      method: 'POST',
      path: '/v1/chat/completions',
      handler: chatCompletionsHandler,
      // OpenAI SDK compatibility: auto-detects format, routes to configured provider
      // Default target: openai | Override: X-Target-Provider header
    },
    {
      method: 'POST',
      path: '/v1/messages',
      handler: messagesHandler,
      // Anthropic SDK compatibility: enforces Anthropic format input
      // Default target: anthropic | Override: X-Target-Provider header
    },
    {
      method: 'POST',
      path: '/messages',
      handler: messagesHandler,
      // Alias for /v1/messages (some clients expect version-less path)
    },
    {
      method: 'POST',
      path: '/v1/generateContent',
      handler: generateContentHandler,
      // Gemini API compatibility: auto-detects Gemini format
      // Default target: gemini | Override: X-Target-Provider header
    },

    // Flexible routing endpoints
    {
      method: 'POST',
      path: '/v1/auto',
      handler: autoDetectHandler,
      // Auto-detect format and route to matching provider
      // Supports all formats (OpenAI, Anthropic, Gemini, Antigravity)
    },
    {
      method: 'POST',
      path: '/v1/proxy',
      handler: explicitProxyHandler,
      // Explicit provider routing via X-Target-Provider header (required)
      // Returns 400 if header missing
    },

    // Responses API endpoint
    {
      method: 'POST',
      path: '/v1/responses',
      handler: responsesHandler,
      // Normalized OpenAI Responses API format for all providers
      // Input: OpenAI format | Output: OpenAI Responses API format
      // Supports streaming transformation and model-based provider detection
    },

    // Codex CLI compatible endpoint
    {
      method: 'POST',
      path: '/backend-api/codex/responses',
      handler: createCodexResponsesHandler(options.modelMappings, options.credentialProvider),
      // Codex CLI compatible endpoint: forces openai-web provider
      // Same as /v1/responses but with targetProvider: "openai-web"
    },
  ]
}

export async function startServer(config?: Partial<ServerConfig>): Promise<LlmuxServer> {
  const mergedConfig = { ...defaultConfig, ...config }

  const modelMappings = mergedConfig.amp?.modelMappings

  let modelRouter: Router | undefined

  // Transform AmpConfig modelMappings to RoutingConfig for the Router
  if (modelMappings) {
    const routingConfig: RoutingConfig = {
      modelMapping: {},
    }

    for (const mapping of modelMappings) {
      const targets = Array.isArray(mapping.to) ? mapping.to : [mapping.to]
      if (targets.length === 0) continue

      // Process primary model
      const primaryTarget = targets[0]
      if (!primaryTarget) continue
      const primaryParsed = parseModelMapping(primaryTarget)
      const primaryProvider =
        (primaryParsed.provider as ProviderName) || inferProvider(primaryParsed.model || '')

      // Process fallbacks
      const fallbacks = targets.slice(1)
      const fallbackModels: string[] = []

      for (const fallback of fallbacks) {
        const fallbackParsed = parseModelMapping(fallback)
        // Store only the model name in the fallback list, but register the mapping
        fallbackModels.push(fallbackParsed.model)
      }

      if (routingConfig.modelMapping) {
        // Register primary mapping
        routingConfig.modelMapping[mapping.from] = {
          provider: primaryProvider,
          model: primaryParsed.model,
          fallbacks: fallbackModels,
        }

        // Also register primary target model itself so it can be resolved/rate-limited by name
        if (!routingConfig.modelMapping[primaryParsed.model]) {
          routingConfig.modelMapping[primaryParsed.model] = {
            provider: primaryProvider,
            model: primaryParsed.model,
            fallbacks: fallbackModels,
          }
        }

        // Register mappings for fallbacks so Router can resolve their providers
        for (const fallback of fallbacks) {
          const fallbackParsed = parseModelMapping(fallback)
          const fallbackProvider =
            (fallbackParsed.provider as ProviderName) || inferProvider(fallbackParsed.model || '')

          if (!routingConfig.modelMapping[fallbackParsed.model]) {
            routingConfig.modelMapping[fallbackParsed.model] = {
              provider: fallbackProvider,
              model: fallbackParsed.model,
            }
          }
        }
      }
    }

    const cooldownManager = new CooldownManager()
    modelRouter = new Router(routingConfig, cooldownManager)
  }

  const routes = createDefaultRoutes({
    credentialProvider: mergedConfig.credentialProvider,
    modelMappings: modelMappings,
    router: modelRouter,
  })

  if (mergedConfig.amp) {
    const ampConfig = mergedConfig.amp
    let upstreamProxy: UpstreamProxy | null = null
    let fallbackHandler: FallbackHandler | undefined

    if (ampConfig.upstreamUrl || ampConfig.providerChecker) {
      upstreamProxy = ampConfig.upstreamUrl
        ? createUpstreamProxy({
            targetUrl: ampConfig.upstreamUrl,
            apiKey: ampConfig.upstreamApiKey,
          })
        : null
      const providerChecker = ampConfig.providerChecker ?? (() => false)

      // Create ModelLookup for model→provider resolution if credentialProvider exists
      const modelLookup = mergedConfig.credentialProvider
        ? (await import('./models/lookup')).createModelLookup(mergedConfig.credentialProvider)
        : undefined

      fallbackHandler = new FallbackHandler(
        () => upstreamProxy,
        providerChecker,
        modelMappings,
        modelLookup,
        modelRouter
      )
    }

    const ampRoutes = createAmpRoutes({
      handlers: ampConfig.handlers,
      fallbackHandler,
      upstreamUrl: ampConfig.upstreamUrl,
    })
    routes.push(...ampRoutes)

    if (ampConfig.enableManagementRoutes !== false && upstreamProxy) {
      const proxyRef = upstreamProxy
      const managementRoutes = createManagementRoutes({
        getProxy: () => proxyRef,
        restrictToLocalhost: ampConfig.restrictManagementToLocalhost ?? true,
      })
      routes.push(...managementRoutes)
    }
  }

  let fetchHandler = createRouter(routes)

  if (mergedConfig.corsOrigins && mergedConfig.corsOrigins.length > 0) {
    fetchHandler = corsMiddleware(mergedConfig.corsOrigins, fetchHandler)
  }

  // Debug: Log registered routes
  logger.debug({ routes: routes.map((r) => `${r.method} ${r.path}`) }, 'Registered routes')

  const server = Bun.serve({
    port: mergedConfig.port,
    hostname: mergedConfig.hostname,
    fetch: fetchHandler,
    idleTimeout: 255, // 255 seconds (max allowed) to prevent early socket closure for long outputs
  })

  const actualPort = server.port ?? mergedConfig.port

  return {
    port: actualPort,
    hostname: mergedConfig.hostname,
    stop: async () => {
      server.stop()
    },
  }
}
