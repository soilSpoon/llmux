export function corsMiddleware(
  origins: string[],
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestOrigin = request.headers.get('Origin')
    const isAllowed =
      origins.includes('*') || (requestOrigin !== null && origins.includes(requestOrigin))
    const allowedOrigin = origins.includes('*') ? '*' : requestOrigin

    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }

      if (isAllowed && allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin
      }

      return new Response(null, {
        status: 204,
        headers,
      })
    }

    const response = await handler(request)

    if (isAllowed && allowedOrigin) {
      const newHeaders = new Headers(response.headers)
      newHeaders.set('Access-Control-Allow-Origin', allowedOrigin)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      })
    }

    return response
  }
}
