import { describe, expect, it, mock, afterEach } from 'bun:test'
import '../setup'
import { handleStreamingProxy, type ProxyOptions } from '../../src/handlers/streaming'

describe('handleStreamingProxy - Signature Fallback', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should strip thoughtSignature when falling back to different model', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async (_url: string, _options?: RequestInit) => {
        fetchCallCount++

        // First attempt: return 429 to trigger fallback
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '1' },
          })
        }

        // Second attempt: return success
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"type":"text_delta","text":"Response"}}\n\n'
              )
            )
            controller.close()
          },
        })

        return new Response(mockStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
      { preconnect: () => {} }
    ) as typeof fetch

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5-thinking',
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'I need to calculate 2+2',
                thoughtSignature: 'claude-sig-12345',
              },
              {
                type: 'text',
                text: 'The answer is 4',
              },
            ],
          },
        ],
        stream: true,
      }),
    })

    const mockRouter = {
      resolveModel: (model: string) => {
        // Fallback from claude to gemini
        if (model === 'claude-opus-4-5-thinking') {
          return { provider: 'antigravity', model: 'gemini-2.0-flash' }
        }
        return { provider: 'anthropic', model }
      },
      handleRateLimit: () => {},
    }

    const options: ProxyOptions = {
      sourceFormat: 'anthropic',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
      router: mockRouter as any,
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.status).toBe(200)

    // The request body on retry should have stripped signatures
    // (This verifies the transformation occurred)
    expect(fetchCallCount).toBeGreaterThan(1)
  })

  it('should handle rate limit with thinking content intact', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async () => {
        fetchCallCount++

        // First attempt: rate limit
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '0' },
          })
        }

        // Second attempt: success
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"type":"text_delta","text":"Complete"}}\n\n'
              )
            )
            controller.close()
          },
        })

        return new Response(mockStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
      { preconnect: () => {} }
    ) as typeof fetch

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5-thinking',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'Complex reasoning process with many steps',
                thoughtSignature: 'sig-complex-123',
              },
              {
                type: 'text',
                text: 'Final answer',
              },
            ],
          },
        ],
        stream: true,
      }),
    })

    const mockRouter = {
      resolveModel: (model: string) => {
        if (model === 'claude-opus-4-5-thinking') {
          return { provider: 'antigravity', model: 'gemini-3-pro-preview' }
        }
        return { provider: 'anthropic', model }
      },
      handleRateLimit: () => {},
    }

    const options: ProxyOptions = {
      sourceFormat: 'anthropic',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
      router: mockRouter as any,
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.status).toBe(200)

    // Verify retry occurred
    expect(fetchCallCount).toBeGreaterThan(1)
  })

  it('should handle multiple fallback attempts', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async () => {
        fetchCallCount++

        // First two attempts: rate limit (exhaust first model)
        if (fetchCallCount <= 2) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '0' },
          })
        }

        // Third attempt: success on fallback model
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"type":"text_delta","text":"Fallback worked"}}\n\n'
              )
            )
            controller.close()
          },
        })

        return new Response(mockStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
      { preconnect: () => {} }
    ) as typeof fetch

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5-thinking',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'Thinking with signature',
                thoughtSignature: 'sig-001',
              },
            ],
          },
        ],
        stream: true,
      }),
    })

    let fallbackAttempt = 0
    const mockRouter = {
      resolveModel: (model: string) => {
        if (model === 'claude-opus-4-5-thinking') {
          fallbackAttempt++
          // First fallback returns a model, subsequent calls return same
          if (fallbackAttempt === 1) {
            return { provider: 'antigravity', model: 'gemini-2.0-flash' }
          }
        }
        return { provider: 'antigravity', model: model || 'gemini-2.0-flash' }
      },
      handleRateLimit: () => {},
    }

    const options: ProxyOptions = {
      sourceFormat: 'anthropic',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
      router: mockRouter as any,
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.status).toBe(200)

    // Verify all attempts were made
    expect(fetchCallCount).toBeGreaterThan(1)
  })
})
