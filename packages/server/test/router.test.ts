import { describe, expect, test } from 'bun:test'
import { createRouter, type Route } from '../src/router'

describe('createRouter', () => {
  test('matches GET route', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/health',
        handler: async () => new Response(JSON.stringify({ status: 'ok' })),
      },
    ]
    const router = createRouter(routes)

    const request = new Request('http://localhost/health', { method: 'GET' })
    const response = await router(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('matches POST route', async () => {
    const routes: Route[] = [
      {
        method: 'POST',
        path: '/v1/chat/completions',
        handler: async () =>
          new Response(JSON.stringify({ message: 'received' })),
      },
    ]
    const router = createRouter(routes)

    const request = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    })
    const response = await router(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.message).toBe('received')
  })

  test('returns 404 for unmatched path', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/health',
        handler: async () => new Response('ok'),
      },
    ]
    const router = createRouter(routes)

    const request = new Request('http://localhost/unknown', { method: 'GET' })
    const response = await router(request)

    expect(response.status).toBe(404)
  })

  test('returns 405 for wrong method', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/health',
        handler: async () => new Response('ok'),
      },
    ]
    const router = createRouter(routes)

    const request = new Request('http://localhost/health', { method: 'POST' })
    const response = await router(request)

    expect(response.status).toBe(405)
  })

  test('handles multiple routes', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/health',
        handler: async () => new Response('health'),
      },
      {
        method: 'GET',
        path: '/providers',
        handler: async () => new Response('providers'),
      },
      {
        method: 'POST',
        path: '/v1/chat/completions',
        handler: async () => new Response('chat'),
      },
    ]
    const router = createRouter(routes)

    const r1 = await router(
      new Request('http://localhost/health', { method: 'GET' })
    )
    const r2 = await router(
      new Request('http://localhost/providers', { method: 'GET' })
    )
    const r3 = await router(
      new Request('http://localhost/v1/chat/completions', { method: 'POST' })
    )

    expect(await r1.text()).toBe('health')
    expect(await r2.text()).toBe('providers')
    expect(await r3.text()).toBe('chat')
  })

  test('handles handler errors gracefully', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/error',
        handler: async () => {
          throw new Error('Test error')
        },
      },
    ]
    const router = createRouter(routes)

    const request = new Request('http://localhost/error', { method: 'GET' })
    const response = await router(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Test error')
  })
})
