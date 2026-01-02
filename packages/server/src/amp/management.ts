import { createLogger } from '@llmux/core'
import type { Route, RouteParams } from '../router'
import type { UpstreamProxy } from '../upstream/proxy'

const logger = createLogger({ service: 'management-routes' })

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>
export type HttpMethod = 'GET' | 'POST'

export interface ManagementRoutesConfig {
  getProxy: () => UpstreamProxy | null
  restrictToLocalhost?: boolean
  upstreamUrl?: string
}

const API_PATHS = [
  '/api/internal',
  '/api/user',
  '/api/auth',
  '/api/meta',
  '/api/ads',
  '/api/telemetry',
  '/api/threads',
  '/api/otel',
  '/api/tab',
  '/api/provider',
] as const

const BROWSER_REDIRECT_PATHS = ['/threads', '/docs', '/settings', '/auth'] as const

const STATIC_PATHS = ['/threads.rss', '/news.rss'] as const

const DEFAULT_UPSTREAM_URL = 'https://ampcode.com'

const LOCALHOST_PATTERNS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

function isLocalhostRequest(request: Request): boolean {
  const url = new URL(request.url)
  return LOCALHOST_PATTERNS.has(url.hostname)
}

function isBrowserRequest(request: Request): boolean {
  const accept = request.headers.get('accept') || ''
  return accept.includes('text/html')
}

function createErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createRedirectHandler(upstreamUrl: string): RouteHandler {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const upstreamAddress = new URL(url.pathname + url.search, upstreamUrl).toString()

    return new Response(null, {
      status: 307,
      headers: { Location: upstreamAddress },
    })
  }
}

function createProxyHandler(config: ManagementRoutesConfig): RouteHandler {
  return async (request: Request, _params?: RouteParams): Promise<Response> => {
    const url = new URL(request.url)

    if (config.restrictToLocalhost && !isLocalhostRequest(request)) {
      logger.warn({ hostname: url.hostname }, '[management] Access denied - not localhost')
      return createErrorResponse('Access denied: management routes restricted to localhost', 403)
    }

    const proxy = config.getProxy()
    if (!proxy) {
      logger.error({}, '[management] Amp upstream proxy not available')
      return createErrorResponse('Amp upstream proxy not available', 503)
    }

    const newRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: request.body ? 'half' : undefined,
    })
    const response = await proxy.proxyRequest(newRequest)

    if (!response.ok) {
      logger.warn(
        { status: response.status, url: request.url },
        '[management] Proxy returned error response'
      )
    }

    return response
  }
}

export function createManagementRoutes(config: ManagementRoutesConfig): Route[] {
  const upstreamUrl = config.upstreamUrl ?? DEFAULT_UPSTREAM_URL
  const proxyHandler = createProxyHandler(config)
  const redirectHandler = createRedirectHandler(upstreamUrl)

  const browserAwareHandler: RouteHandler = async (request, params) => {
    if (isBrowserRequest(request)) {
      return redirectHandler(request, params)
    }
    return proxyHandler(request, params)
  }

  const addRoutesForPath = (
    basePath: string,
    methods: readonly HttpMethod[],
    handler: RouteHandler,
    includeWildcard = true
  ): Route[] => {
    const routes: Route[] = []
    for (const method of methods) {
      routes.push({ method, path: basePath, handler })
      if (includeWildcard) {
        routes.push({ method, path: `${basePath}/*path`, handler })
      }
    }
    return routes
  }

  type RouteConfig = {
    paths: readonly string[]
    methods: readonly HttpMethod[]
    handler: RouteHandler
    includeWildcard?: boolean
  }

  const routeConfigs: RouteConfig[] = [
    { paths: API_PATHS, methods: ['GET', 'POST'], handler: proxyHandler },
    { paths: BROWSER_REDIRECT_PATHS, methods: ['GET'], handler: browserAwareHandler },
    { paths: BROWSER_REDIRECT_PATHS, methods: ['POST'], handler: proxyHandler },
    { paths: STATIC_PATHS, methods: ['GET'], handler: proxyHandler, includeWildcard: false },
  ]

  return routeConfigs.flatMap(({ paths, methods, handler, includeWildcard = true }) =>
    paths.flatMap((path) => addRoutesForPath(path, methods, handler, includeWildcard))
  )
}
