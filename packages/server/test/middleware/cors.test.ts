import { describe, expect, test } from 'bun:test'
import { corsMiddleware } from '../../src/middleware/cors'

describe('corsMiddleware', () => {
  const mockHandler = async (_req: Request) =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })

  test('adds CORS headers for allowed origin', async () => {
    const handler = corsMiddleware(['http://localhost:3000'], mockHandler)
    const request = new Request('http://localhost/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const response = await handler(request)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000'
    )
  })

  test('does not add CORS headers for disallowed origin', async () => {
    const handler = corsMiddleware(['http://localhost:3000'], mockHandler)
    const request = new Request('http://localhost/test', {
      headers: { Origin: 'http://evil.com' },
    })
    const response = await handler(request)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('handles OPTIONS preflight request', async () => {
    const handler = corsMiddleware(['http://localhost:3000'], mockHandler)
    const request = new Request('http://localhost/test', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    })
    const response = await handler(request)

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000'
    )
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, OPTIONS'
    )
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization'
    )
  })

  test('allows wildcard origin', async () => {
    const handler = corsMiddleware(['*'], mockHandler)
    const request = new Request('http://localhost/test', {
      headers: { Origin: 'http://any-domain.com' },
    })
    const response = await handler(request)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('calls underlying handler for non-OPTIONS requests', async () => {
    const handler = corsMiddleware(['http://localhost:3000'], mockHandler)
    const request = new Request('http://localhost/test', {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000' },
    })
    const response = await handler(request)

    const data = await response.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  test('allows multiple origins', async () => {
    const handler = corsMiddleware(
      ['http://localhost:3000', 'http://localhost:5000'],
      mockHandler
    )

    const request1 = new Request('http://localhost/test', {
      headers: { Origin: 'http://localhost:3000' },
    })
    const response1 = await handler(request1)
    expect(response1.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000'
    )

    const request2 = new Request('http://localhost/test', {
      headers: { Origin: 'http://localhost:5000' },
    })
    const response2 = await handler(request2)
    expect(response2.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5000'
    )
  })
})
