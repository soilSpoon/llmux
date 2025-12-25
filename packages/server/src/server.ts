import { getRegisteredProviders } from '@llmux/core'
import { createAmpRoutes, type ProviderHandlers } from './amp/routes'
import { FallbackHandler, type ProviderChecker } from './handlers/fallback'
import { handleHealth } from './handlers/health'
import { handleProxy, type ProxyOptions } from './handlers/proxy'
import { handleStreamingProxy } from './handlers/streaming'
import { corsMiddleware } from './middleware/cors'
import { detectFormat } from './middleware/format'
import { createRouter, type Route } from './router'
import { createUpstreamProxy } from './upstream/proxy'

export interface AmpConfig {
  handlers: ProviderHandlers
  upstreamUrl?: string
  upstreamApiKey?: string
  providerChecker?: ProviderChecker
}

export interface ServerConfig {
  port: number
  hostname: string
  corsOrigins?: string[]
  amp?: AmpConfig
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

type RequestFormat = ProxyOptions['sourceFormat']

interface BuildProxyOptionsParams {
  request: Request
  body: RequestBody
  defaultTargetProvider?: string
  overrideSourceFormat?: RequestFormat
}

function buildProxyOptions({
  request,
  body,
  defaultTargetProvider = 'anthropic',
  overrideSourceFormat,
}: BuildProxyOptionsParams): ProxyOptions {
  const sourceFormat = overrideSourceFormat ?? detectFormat(body)
  const targetProvider = request.headers.get('X-Target-Provider') ?? defaultTargetProvider
  const targetModel = request.headers.get('X-Target-Model') ?? undefined
  const apiKey = request.headers.get('X-API-Key') ?? undefined

  return {
    sourceFormat,
    targetProvider,
    targetModel,
    apiKey,
  }
}

async function handleChatCompletions(request: Request): Promise<Response> {
  const body = (await request.clone().json()) as RequestBody
  const options = buildProxyOptions({ request, body })

  if (body.stream) {
    return handleStreamingProxy(request, options)
  }
  return handleProxy(request, options)
}

async function handleMessages(request: Request): Promise<Response> {
  const body = (await request.clone().json()) as RequestBody
  const options = buildProxyOptions({
    request,
    body,
    defaultTargetProvider: 'openai',
    overrideSourceFormat: 'anthropic',
  })

  if (body.stream) {
    return handleStreamingProxy(request, options)
  }
  return handleProxy(request, options)
}

async function handleGenerateContent(request: Request): Promise<Response> {
  const body = (await request.clone().json()) as RequestBody
  const options = buildProxyOptions({ request, body })

  if (body.stream) {
    return handleStreamingProxy(request, options)
  }
  return handleProxy(request, options)
}

async function handleExplicitProxy(request: Request): Promise<Response> {
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
  })

  if (body.stream) {
    return handleStreamingProxy(request, options)
  }
  return handleProxy(request, options)
}

function createDefaultRoutes(): Route[] {
  return [
    { method: 'GET', path: '/health', handler: handleHealth },
    { method: 'GET', path: '/providers', handler: handleProviders },
    {
      method: 'POST',
      path: '/v1/chat/completions',
      handler: handleChatCompletions,
    },
    { method: 'POST', path: '/v1/messages', handler: handleMessages },
    {
      method: 'POST',
      path: '/v1/generateContent',
      handler: handleGenerateContent,
    },
    { method: 'POST', path: '/v1/proxy', handler: handleExplicitProxy },
  ]
}

export async function startServer(config?: Partial<ServerConfig>): Promise<LlmuxServer> {
  const mergedConfig = { ...defaultConfig, ...config }

  const routes = createDefaultRoutes()

  if (mergedConfig.amp) {
    const ampConfig = mergedConfig.amp
    let fallbackHandler: FallbackHandler | undefined

    if (ampConfig.upstreamUrl || ampConfig.providerChecker) {
      const proxy = ampConfig.upstreamUrl
        ? createUpstreamProxy({
            targetUrl: ampConfig.upstreamUrl,
            apiKey: ampConfig.upstreamApiKey,
          })
        : null
      const providerChecker = ampConfig.providerChecker ?? (() => false)
      fallbackHandler = new FallbackHandler(() => proxy, providerChecker)
    }

    const ampRoutes = createAmpRoutes({
      handlers: ampConfig.handlers,
      fallbackHandler,
    })
    routes.push(...ampRoutes)
  }

  let fetchHandler = createRouter(routes)

  if (mergedConfig.corsOrigins && mergedConfig.corsOrigins.length > 0) {
    fetchHandler = corsMiddleware(mergedConfig.corsOrigins, fetchHandler)
  }

  const server = Bun.serve({
    port: mergedConfig.port,
    hostname: mergedConfig.hostname,
    fetch: fetchHandler,
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
