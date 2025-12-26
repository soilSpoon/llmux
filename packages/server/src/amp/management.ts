import type { Route, RouteParams } from '../router'
import type { UpstreamProxy } from '../upstream/proxy'

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>

export interface ManagementRoutesConfig {
  getProxy: () => UpstreamProxy | null
  restrictToLocalhost?: boolean
}

const MANAGEMENT_PATHS = [
  '/api/internal',
  '/api/user',
  '/api/auth',
  '/api/meta',
  '/api/ads',
  '/api/telemetry',
  '/api/threads',
  '/api/otel',
  '/api/tab',
  '/threads',
  '/docs',
  '/settings',
  '/auth',
]

function isLocalhostRequest(request: Request): boolean {
  const url = new URL(request.url)
  const host = url.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function createProxyHandler(config: ManagementRoutesConfig): RouteHandler {
  return async (request: Request, _params?: RouteParams): Promise<Response> => {
    if (config.restrictToLocalhost && !isLocalhostRequest(request)) {
      return new Response(
        JSON.stringify({
          error: 'Access denied: management routes restricted to localhost',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const proxy = config.getProxy()
    if (!proxy) {
      return new Response(JSON.stringify({ error: 'amp upstream proxy not available' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const newRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    })

    return proxy.proxyRequest(newRequest)
  }
}

export function createManagementRoutes(config: ManagementRoutesConfig): Route[] {
  const proxyHandler = createProxyHandler(config)

  const routes: Route[] = []

  for (const basePath of MANAGEMENT_PATHS) {
    routes.push({
      method: 'GET',
      path: basePath,
      handler: proxyHandler,
    })
    routes.push({
      method: 'POST',
      path: basePath,
      handler: proxyHandler,
    })
    routes.push({
      method: 'GET',
      path: `${basePath}/*path`,
      handler: proxyHandler,
    })
    routes.push({
      method: 'POST',
      path: `${basePath}/*path`,
      handler: proxyHandler,
    })
  }

  routes.push({
    method: 'GET',
    path: '/threads.rss',
    handler: proxyHandler,
  })
  routes.push({
    method: 'GET',
    path: '/news.rss',
    handler: proxyHandler,
  })

  return routes
}
