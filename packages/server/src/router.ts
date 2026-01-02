import { createLogger } from '@llmux/core'
export type RouteParams = Record<string, string>

export interface Route {
  method: 'GET' | 'POST'
  path: string
  handler: (request: Request, params?: RouteParams) => Promise<Response>
}

type RouteType = 'exact' | 'param' | 'wildcard'

interface ParsedRoute {
  route: Route
  type: RouteType
  segments: string[]
  paramNames: string[]
  wildcardName: string | null
  wildcardIndex: number
}

function parseRoute(route: Route): ParsedRoute {
  const segments = route.path.split('/').filter(Boolean)
  const paramNames: string[] = []
  let wildcardName: string | null = null
  let wildcardIndex = -1
  let type: RouteType = 'exact'

  for (const [idx, seg] of segments.entries()) {
    if (seg.startsWith('*')) {
      wildcardName = seg.slice(1)
      wildcardIndex = idx
      type = 'wildcard'
      break
    } else if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1))
      if (type === 'exact') type = 'param'
    }
  }

  return { route, type, segments, paramNames, wildcardName, wildcardIndex }
}

interface MatchResult {
  matched: boolean
  params: RouteParams
}

function matchPath(parsed: ParsedRoute, pathname: string): MatchResult {
  const pathSegments = pathname.split('/').filter(Boolean)
  const params: RouteParams = {}

  if (parsed.wildcardIndex >= 0) {
    if (pathSegments.length < parsed.wildcardIndex) {
      return { matched: false, params: {} }
    }

    for (let i = 0; i < parsed.wildcardIndex; i++) {
      const routeSeg = parsed.segments[i] as string
      const pathSeg = pathSegments[i] as string

      if (routeSeg.startsWith(':')) {
        params[routeSeg.slice(1)] = pathSeg
      } else if (routeSeg !== pathSeg) {
        return { matched: false, params: {} }
      }
    }

    if (parsed.wildcardName) {
      params[parsed.wildcardName] = pathSegments.slice(parsed.wildcardIndex).join('/')
    }

    return { matched: true, params }
  }

  if (pathSegments.length !== parsed.segments.length) {
    return { matched: false, params: {} }
  }

  for (let i = 0; i < parsed.segments.length; i++) {
    const routeSeg = parsed.segments[i] as string
    const pathSeg = pathSegments[i] as string

    if (routeSeg.startsWith(':')) {
      params[routeSeg.slice(1)] = pathSeg
    } else if (routeSeg !== pathSeg) {
      return { matched: false, params: {} }
    }
  }

  return { matched: true, params }
}

function getRoutePriority(parsed: ParsedRoute): number {
  if (parsed.type === 'exact') {
    return 1000
  }

  if (parsed.type === 'param') {
    return 100 + parsed.segments.length
  }

  if (parsed.type === 'wildcard') {
    // More specific wildcard routes (higher wildcardIndex) get higher priority
    // e.g., /api/provider/:provider/v1beta1/.../models/*action (wildcardIndex=8)
    // should beat /api/provider/*path (wildcardIndex=2)
    return 10 + parsed.wildcardIndex
  }

  return 0
}

export function createRouter(routes: Route[]): (request: Request) => Promise<Response> {
  const parsedRoutes = routes.map(parseRoute)
  const logger = createLogger({ service: 'router' })

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const method = request.method as 'GET' | 'POST'
    const pathname = url.pathname

    logger.trace({ method, pathname }, '[Router] Incoming request')

    const methodRoutes = parsedRoutes.filter((p) => p.route.method === method)

    const matches: Array<{
      parsed: ParsedRoute
      params: RouteParams
      priority: number
    }> = []

    for (const parsed of methodRoutes) {
      const result = matchPath(parsed, pathname)
      if (result.matched) {
        const priority = getRoutePriority(parsed)
        matches.push({ parsed, params: result.params, priority })
      }
    }

    if (matches.length === 0) {
      const anyPathMatch = parsedRoutes.some((p) => matchPath(p, pathname).matched)

      if (anyPathMatch) {
        logger.warn({ method, pathname }, '[Router] Method not allowed')
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      logger.warn({ method, pathname }, '[Router] No match found')
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    matches.sort((a, b) => b.priority - a.priority)
    const best = matches[0] as (typeof matches)[0]

    logger.trace({ method, pathname, route: best.parsed.route.path }, '[Router] Matched route')

    try {
      return await best.parsed.route.handler(request, best.params)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ method, pathname, error: message }, '[Router] Handler error')
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}
