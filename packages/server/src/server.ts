import {
  AntigravityProvider as AntigravityAuthProvider,
  AuthProviderRegistry,
  GithubCopilotProvider,
  OpenAIWebProvider,
  OpencodeZenProvider as OpencodeZenAuthProvider,
} from '@llmux/auth'
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
import type { AmpModelMapping } from './config'
import { FallbackHandler, type ProviderChecker } from './handlers/fallback'
import { handleHealth } from './handlers/health'
import { handleModels } from './handlers/models'
import { handleProxy, type ProxyOptions } from './handlers/proxy'
import { handleResponses, type ResponsesOptions } from './handlers/responses'
import { handleStatus } from './handlers/status'
import { handleStreamingProxy } from './handlers/streaming'
import { corsMiddleware } from './middleware/cors'
import { detectFormat, type RequestFormat } from './middleware/format'
import { createModelLookup } from './models/lookup'
import { createRouter, type Route } from './router'
import { Router } from './routing'
import { buildRoutingConfig } from './routing/config-builder'
import { createUpstreamProxy, type UpstreamProxy } from './upstream/proxy'

const logger = createLogger({ service: 'server' })

registerProvider(new OpenAIProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
registerProvider(new OpencodeZenProvider())
registerProvider(new CoreOpenAIWebProvider())

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
  modelMappings?: AmpModelMapping[]
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
  model?: string
}

interface BuildProxyOptionsParams {
  request: Request
  body: RequestBody
  defaultTargetProvider?: string
  overrideSourceFormat?: RequestFormat
  modelMappings?: AmpConfig['modelMappings']
  router?: Router
}

async function createProxyLikeHandler(
  request: Request,
  params: BuildProxyOptionsParams
): Promise<Response> {
  const { body, overrideSourceFormat, defaultTargetProvider, modelMappings, router } = params
  const sourceFormat = overrideSourceFormat ?? detectFormat(body)
  const targetProvider = request.headers.get('X-Target-Provider') || defaultTargetProvider

  const options: ProxyOptions = {
    sourceFormat,
    targetProvider: targetProvider,
    targetModel: request.headers.get('X-Target-Model') ?? undefined,
    apiKey: request.headers.get('X-API-Key') ?? undefined,
    modelMappings,
    router,
  }

  if (body.stream) {
    return handleStreamingProxy(request, options)
  }
  return handleProxy(request, options)
}

function createProxyHandler(
  modelMappings?: AmpConfig['modelMappings'],
  router?: Router,
  overrideSourceFormat?: RequestFormat,
  defaultProvider?: string
) {
  return async (request: Request): Promise<Response> => {
    const body = (await request.clone().json()) as RequestBody
    return createProxyLikeHandler(request, {
      request,
      body,
      defaultTargetProvider: defaultProvider,
      overrideSourceFormat,
      modelMappings,
      router,
    })
  }
}

function createAutoHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    const body = (await request.clone().json()) as RequestBody
    const detectedFormat = detectFormat(body)
    return createProxyLikeHandler(request, {
      request,
      body,
      defaultTargetProvider: detectedFormat,
      overrideSourceFormat: detectedFormat,
      modelMappings,
      router,
    })
  }
}

function createExplicitHandler(modelMappings?: AmpConfig['modelMappings'], router?: Router) {
  return async (request: Request): Promise<Response> => {
    const targetProvider = request.headers.get('X-Target-Provider')
    if (!targetProvider) {
      return new Response(JSON.stringify({ error: 'X-Target-Provider header required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const body = (await request.clone().json()) as RequestBody
    return createProxyLikeHandler(request, {
      request,
      body,
      defaultTargetProvider: targetProvider,
      modelMappings,
      router,
    })
  }
}

function createResponsesHandler(
  modelMappings?: AmpConfig['modelMappings'],
  credentialProvider?: CredentialProvider,
  router?: Router
) {
  return async (request: Request): Promise<Response> => {
    const options: ResponsesOptions = {
      targetProvider: request.headers.get('X-Target-Provider') ?? undefined,
      targetModel: request.headers.get('X-Target-Model') ?? undefined,
      apiKey: request.headers.get('X-API-Key') ?? undefined,
      modelMappings,
      credentialProvider,
      router,
    }
    return handleResponses(request, options)
  }
}

function createCodexResponsesHandler(
  modelMappings?: AmpConfig['modelMappings'],
  credentialProvider?: CredentialProvider
) {
  return async (request: Request): Promise<Response> => {
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

  const chatCompletionsHandler = createProxyHandler(options.modelMappings, options.router)
  const messagesHandler = createProxyHandler(
    options.modelMappings,
    options.router,
    'anthropic',
    'anthropic'
  )
  const generateContentHandler = createProxyHandler(options.modelMappings, options.router)
  const responsesHandler = createResponsesHandler(
    options.modelMappings,
    options.credentialProvider,
    options.router
  )

  return [
    { method: 'GET', path: '/health', handler: handleHealth },
    { method: 'GET', path: '/status', handler: handleStatus },
    { method: 'GET', path: '/providers', handler: handleProviders },
    { method: 'GET', path: '/models', handler: modelsHandler },
    { method: 'POST', path: '/v1/chat/completions', handler: chatCompletionsHandler },
    { method: 'POST', path: '/v1/messages', handler: messagesHandler },
    { method: 'POST', path: '/messages', handler: messagesHandler },
    { method: 'POST', path: '/v1/generateContent', handler: generateContentHandler },
    {
      method: 'POST',
      path: '/v1/auto',
      handler: createAutoHandler(options.modelMappings, options.router),
    },
    {
      method: 'POST',
      path: '/v1/proxy',
      handler: createExplicitHandler(options.modelMappings, options.router),
    },
    { method: 'POST', path: '/v1/responses', handler: responsesHandler },
    {
      method: 'POST',
      path: '/backend-api/codex/responses',
      handler: createCodexResponsesHandler(options.modelMappings, options.credentialProvider),
    },
  ]
}

export async function startServer(config?: Partial<ServerConfig>): Promise<LlmuxServer> {
  const mergedConfig = { ...defaultConfig, ...config }
  const modelMappings = mergedConfig.amp?.modelMappings

  const modelLookup = mergedConfig.credentialProvider
    ? createModelLookup(mergedConfig.credentialProvider)
    : undefined

  let modelRouter: Router | undefined

  if (modelMappings) {
    const routingConfig = await buildRoutingConfig(modelMappings, modelLookup)
    modelRouter = new Router(routingConfig, modelLookup)
  } else if (modelLookup) {
    modelRouter = new Router({}, modelLookup)
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

    if (ampConfig.upstreamUrl || ampConfig.providerChecker || modelMappings || modelRouter) {
      upstreamProxy = ampConfig.upstreamUrl
        ? createUpstreamProxy({
            targetUrl: ampConfig.upstreamUrl,
            apiKey: ampConfig.upstreamApiKey,
          })
        : null
      const providerChecker = ampConfig.providerChecker ?? (() => false)

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

  logger.debug({ routes: routes.map((r) => `${r.method} ${r.path}`) }, 'Registered routes')

  const server = Bun.serve({
    port: mergedConfig.port,
    hostname: mergedConfig.hostname,
    fetch: fetchHandler,
    idleTimeout: 255,
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
