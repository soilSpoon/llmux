export interface Route {
  method: 'GET' | 'POST'
  path: string
  handler: (request: Request) => Promise<Response>
}

export function createRouter(routes: Route[]): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const method = request.method as 'GET' | 'POST'

    const matchingPath = routes.find((r) => r.path === url.pathname)

    if (!matchingPath) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const matchingRoute = routes.find((r) => r.path === url.pathname && r.method === method)

    if (!matchingRoute) {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      return await matchingRoute.handler(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}
