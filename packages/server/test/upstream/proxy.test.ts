import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createUpstreamProxy } from '../../src/upstream/proxy'
import { createInMemoryServer } from '../../src/utils/in-memory-server'

describe('UpstreamProxy', () => {
  describe('createUpstreamProxy', () => {
    test('should create proxy with valid config', () => {
      const proxy = createUpstreamProxy({
        targetUrl: 'https://api.ampcode.com',
        apiKey: 'test-key',
      })
      expect(proxy).toBeDefined()
      expect(typeof proxy.proxyRequest).toBe('function')
    })

    test('should create proxy without apiKey', () => {
      const proxy = createUpstreamProxy({
        targetUrl: 'https://api.ampcode.com',
      })
      expect(proxy).toBeDefined()
    })

    test('should require targetUrl', () => {
      expect(() => {
        createUpstreamProxy({ targetUrl: '' })
      }).toThrow()
    })
  })

  describe('request forwarding', () => {
    let mockServer: { port: number; stop: () => void }
    let mockServerUrl: string
    const receivedRequests: Array<{
      method: string
      path: string
      headers: Record<string, string>
      body: unknown
    }> = []

    beforeAll(() => {
      mockServer = createInMemoryServer(async (req) => {
          const url = new URL(req.url)
          const headers: Record<string, string> = {}
          req.headers.forEach((value, key) => {
            headers[key] = value
          })

          let body: unknown = null
          if (req.method === 'POST') {
            try {
              body = await req.json()
            } catch {
              body = await req.text()
            }
          }

          receivedRequests.push({
            method: req.method,
            path: url.pathname,
            headers,
            body,
          })

          return new Response(JSON.stringify({ success: true, echo: body }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      })
      mockServerUrl = `http://localhost:${mockServer.port}`
    })

    afterAll(() => {
      mockServer.stop()
    })

    test('should forward request headers and body', async () => {
      receivedRequests.length = 0

      const proxy = createUpstreamProxy({
        targetUrl: mockServerUrl,
        apiKey: 'test-api-key',
      })

      const request = new Request(`${mockServerUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }),
      })

      // The proxy clones the request, so we can't consume the body here before passing it to proxyRequest
      // If we read the body here, it will be consumed and bodyUsed will be true
      
      const response = await proxy.proxyRequest(request)

      expect(response.status).toBe(200)
      expect(receivedRequests.length).toBe(1)
      expect(receivedRequests[0]!.method).toBe('POST')
      expect(receivedRequests[0]!.path).toBe('/v1/chat/completions')
      expect(receivedRequests[0]!.headers['x-custom-header']).toBe('custom-value')
      expect(receivedRequests[0]!.body).toEqual({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    })

    test('should inject Authorization header with upstream credentials', async () => {
      receivedRequests.length = 0

      const proxy = createUpstreamProxy({
        targetUrl: mockServerUrl,
        apiKey: 'upstream-secret-key',
      })

      const request = new Request(`${mockServerUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer client-token', // Client's token should be replaced
        },
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      await proxy.proxyRequest(request)

      expect(receivedRequests.length).toBe(1)
      expect(receivedRequests[0]!.headers['authorization']).toBe('Bearer upstream-secret-key')
    })

    test('should preserve path when proxying', async () => {
      receivedRequests.length = 0

      const proxy = createUpstreamProxy({
        targetUrl: mockServerUrl,
      })

      const request = new Request(`${mockServerUrl}/api/provider/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      })

      await proxy.proxyRequest(request)

      expect(receivedRequests[0]!.path).toBe('/api/provider/openai/v1/chat/completions')
    })
  })

  describe('response handling', () => {
    test('should stream SSE response from upstream', async () => {
      const sseData = [
        'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"2","choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]

      const mockServer = createInMemoryServer(() => {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            async start(controller) {
              for (const chunk of sseData) {
                controller.enqueue(encoder.encode(chunk))
                await new Promise((r) => setTimeout(r, 10))
              }
              controller.close()
            },
          })

          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          })
      })

      try {
        const proxy = createUpstreamProxy({
          targetUrl: `http://localhost:${mockServer.port}`,
        })

        const request = new Request(`http://localhost:${mockServer.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream: true }),
        })

        const response = await proxy.proxyRequest(request)

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/event-stream')

        const text = await response.text()
        expect(text).toContain('data: {"id":"1"')
        expect(text).toContain('data: [DONE]')
      } finally {
        mockServer.stop()
      }
    })

    test('should handle upstream errors gracefully', async () => {
      const mockServer = createInMemoryServer(() => {
          return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
      })

      try {
        const proxy = createUpstreamProxy({
          targetUrl: `http://localhost:${mockServer.port}`,
        })

        const request = new Request(`http://localhost:${mockServer.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4' }),
        })

        const response = await proxy.proxyRequest(request)

        expect(response.status).toBe(429)
        const body = await response.json() as { error: string }
        expect(body.error).toBe('Rate limit exceeded')
      } finally {
        mockServer.stop()
      }
    })

    test('should return 502 on network errors', async () => {
      const proxy = createUpstreamProxy({
        targetUrl: 'http://localhost:59999', // Non-existent port
      })

      const request = new Request('http://localhost:59999/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      // We clone the request before passing it to proxyRequest
      // However, proxyRequest reads the body, and since we can't clone it here (Request body stream is disturbed if read),
      // we need to create a new Request object.
      // But proxyRequest handles body reading internally.
      // The issue is likely that when we pass the request to proxyRequest, it reads it.
      // If we try to read it again or if the mock implementation expects something else, it might fail.
      // Actually, creating a new request from scratch is safer here.
      
      const response = await proxy.proxyRequest(request)

      expect(response.status).toBe(502)
      const body = await response.json() as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  describe('gzip handling', () => {
    test('should handle gzip compressed responses', async () => {
      const responseBody = JSON.stringify({ message: 'Hello, compressed world!' })
      const compressed = Bun.gzipSync(Buffer.from(responseBody))

      const mockServer = createInMemoryServer(() => {
          return new Response(compressed, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
            },
          })
      })

      try {
        const proxy = createUpstreamProxy({
          targetUrl: `http://localhost:${mockServer.port}`,
        })

        const request = new Request(`http://localhost:${mockServer.port}/test`, {
          method: 'GET',
        })

        const response = await proxy.proxyRequest(request)

        expect(response.status).toBe(200)
        const body = await response.json() as { message: string }
        expect(body.message).toBe('Hello, compressed world!')
      } finally {
        mockServer.stop()
      }
    })
  })
})
