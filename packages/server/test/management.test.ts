import { describe, expect, test } from 'bun:test'
import { createManagementRoutes } from '../src/amp/management'
import type { UpstreamProxy } from '../src/upstream/proxy'

function createMockProxy(): UpstreamProxy {
  return {
    async proxyRequest(_request: Request): Promise<Response> {
      return new Response(JSON.stringify({ proxied: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}

describe('createManagementRoutes', () => {
  test('should create routes for all management paths', () => {
    const routes = createManagementRoutes({
      getProxy: () => createMockProxy(),
    })

    expect(routes.length).toBeGreaterThan(0)

    const paths = routes.map((r) => r.path)
    expect(paths).toContain('/api/user')
    expect(paths).toContain('/api/threads')
    expect(paths).toContain('/api/auth')
    expect(paths).toContain('/threads')
    expect(paths).toContain('/auth')
  })

  test('should return 503 when proxy is not available', async () => {
    const routes = createManagementRoutes({
      getProxy: () => null,
    })

    const userRoute = routes.find((r) => r.path === '/api/user' && r.method === 'GET')
    expect(userRoute).toBeDefined()

    const request = new Request('http://localhost:8743/api/user')
    const response = await userRoute!.handler(request)

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toContain('not available')
  })

  test('should proxy request when proxy is available', async () => {
    const routes = createManagementRoutes({
      getProxy: () => createMockProxy(),
    })

    const userRoute = routes.find((r) => r.path === '/api/user' && r.method === 'GET')
    expect(userRoute).toBeDefined()

    const request = new Request('http://localhost:8743/api/user')
    const response = await userRoute!.handler(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.proxied).toBe(true)
  })

  test('should include RSS feed routes', () => {
    const routes = createManagementRoutes({
      getProxy: () => createMockProxy(),
    })

    const paths = routes.map((r) => r.path)
    expect(paths).toContain('/threads.rss')
    expect(paths).toContain('/news.rss')
  })
})
