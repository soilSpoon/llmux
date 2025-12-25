import { describe, expect, test } from 'bun:test'
import { createRouter, type Route, type RouteParams } from '../src/router'

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
    const data = await response.json() as { status: string }
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
    const data = await response.json() as { message: string }
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
    const data = await response.json() as { error: string }
    expect(data.error).toBe('Test error')
  })
})

describe('path parameters', () => {
  test('should pass single path param to handler', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/provider/:provider/models',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/api/provider/openai/models')
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.provider).toBe('openai')
  })

  test('should pass multiple path params to handler', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/:provider/v1/:endpoint',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/api/openai/v1/chat')
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.provider).toBe('openai')
    expect(capturedParams?.endpoint).toBe('chat')
  })

  test('should match path with param in middle segment', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'POST',
        path: '/users/:id/profile',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/users/123/profile', { method: 'POST' })
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.id).toBe('123')
  })

  test('should not match when segment count differs', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/:provider/models',
        handler: async () => new Response('ok'),
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/api/openai/extra/models')
    )
    expect(res.status).toBe(404)
  })
})

describe('wildcard matching', () => {
  test('should match *wildcard and capture rest of path', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'POST',
        path: '/v1beta/models/*action',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/v1beta/models/gemini-pro:generateContent', {
        method: 'POST',
      })
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.action).toBe('gemini-pro:generateContent')
  })

  test('should capture multi-segment path in wildcard', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/files/*path',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/files/a/b/c.txt')
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.path).toBe('a/b/c.txt')
  })

  test('should match wildcard with empty capture', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/*rest',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(new Request('http://localhost/api/'))
    expect(res.status).toBe(200)
    expect(capturedParams?.rest).toBe('')
  })

  test('should combine param and wildcard', async () => {
    let capturedParams: RouteParams | undefined
    const routes: Route[] = [
      {
        method: 'POST',
        path: '/api/provider/:provider/v1beta/*action',
        handler: async (_req, params) => {
          capturedParams = params
          return new Response('ok')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request(
        'http://localhost/api/provider/google/v1beta/models/gemini:generate',
        { method: 'POST' }
      )
    )
    expect(res.status).toBe(200)
    expect(capturedParams?.provider).toBe('google')
    expect(capturedParams?.action).toBe('models/gemini:generate')
  })
})

describe('route priority', () => {
  test('should prioritize exact match over param match', async () => {
    let matchedRoute = ''
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/:resource',
        handler: async () => {
          matchedRoute = 'param'
          return new Response('param')
        },
      },
      {
        method: 'GET',
        path: '/api/health',
        handler: async () => {
          matchedRoute = 'exact'
          return new Response('exact')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(matchedRoute).toBe('exact')
  })

  test('should prioritize param match over wildcard match', async () => {
    let matchedRoute = ''
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/*rest',
        handler: async () => {
          matchedRoute = 'wildcard'
          return new Response('wildcard')
        },
      },
      {
        method: 'GET',
        path: '/api/:resource',
        handler: async () => {
          matchedRoute = 'param'
          return new Response('param')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(new Request('http://localhost/api/users'))
    expect(res.status).toBe(200)
    expect(matchedRoute).toBe('param')
  })

  test('should use wildcard when no exact or param match', async () => {
    let matchedRoute = ''
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/health',
        handler: async () => {
          matchedRoute = 'exact'
          return new Response('exact')
        },
      },
      {
        method: 'GET',
        path: '/api/*rest',
        handler: async () => {
          matchedRoute = 'wildcard'
          return new Response('wildcard')
        },
      },
    ]
    const router = createRouter(routes)

    const res = await router(
      new Request('http://localhost/api/some/nested/path')
    )
    expect(res.status).toBe(200)
    expect(matchedRoute).toBe('wildcard')
  })

  test('should prioritize more specific param routes', async () => {
    let matchedRoute = ''
    const routes: Route[] = [
      {
        method: 'GET',
        path: '/api/:a/:b',
        handler: async () => {
          matchedRoute = 'two-params'
          return new Response('two')
        },
      },
      {
        method: 'GET',
        path: '/api/:a',
        handler: async () => {
          matchedRoute = 'one-param'
          return new Response('one')
        },
      },
    ]
    const router = createRouter(routes)

    await router(new Request('http://localhost/api/users'))
    expect(matchedRoute).toBe('one-param')

    await router(new Request('http://localhost/api/users/123'))
    expect(matchedRoute).toBe('two-params')
  })
})
