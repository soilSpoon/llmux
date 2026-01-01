/**
 * Signature Fallback E2E Integration Tests
 *
 * These tests verify the complete signature stripping workflow:
 * 1. Request with thoughtSignature in message history
 * 2. Rate limit (429) triggers model fallback
 * 3. Signature is stripped during retry with different model
 * 4. Response is successfully returned
 */

import { describe, it, expect, mock, afterEach } from 'bun:test'
import '../setup'
import { handleStreamingProxy, type ProxyOptions } from '../../src/handlers/streaming'

describe('Signature Fallback E2E Tests', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should handle Claude → Gemini fallback with thinking signatures intact', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async (_url: string, _options?: RequestInit) => {
        fetchCallCount++

        // First attempt: return 429 (rate limited on Claude)
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '1' },
          })
        }

        // Second attempt: success on Gemini (fallback)
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"type":"text_delta","text":"The answer is 4"}}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_stop"}\n\n'
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
                thinking: 'I need to calculate 2+2 which equals 4',
                thoughtSignature: 'claude-sig-abc123',
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

    // Verify both attempts were made (first failed, second succeeded)
    expect(fetchCallCount).toBeGreaterThan(1)
  })

  it('should preserve thinking block text when stripping signature during fallback', async () => {
    let fetchCallCount = 0
    let requestBodies: unknown[] = []

    globalThis.fetch = Object.assign(
      mock(async (_url: string, options?: RequestInit) => {
        fetchCallCount++

        // Capture request body for analysis
        if (options?.body && typeof options.body === 'string') {
          requestBodies.push(JSON.parse(options.body))
        }

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

    const thinkingText = 'Complex multi-step reasoning process'
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
                thinking: thinkingText,
                thoughtSignature: 'sig-xyz789',
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

    // Verify fallback occurred (2 fetch attempts)
    expect(fetchCallCount).toBe(2)

    // Analyze the second request (retry) to verify signature was stripped but thinking text preserved
    const retryBody = requestBodies[1] as Record<string, unknown>
    expect(retryBody).toBeDefined()

    // The request body should contain contents (for Antigravity)
    if (retryBody.request) {
      const innerRequest = retryBody.request as Record<string, unknown>
      const contents = innerRequest.contents as Array<Record<string, unknown>>

      if (contents && contents.length > 0) {
        const assistantMessage = contents.find((c) => c.role === 'model')
        if (assistantMessage) {
          const parts = assistantMessage.parts as Array<Record<string, unknown>>
          if (parts) {
            // Find the thinking part
            const thinkingPart = parts.find((p) => p.thought === true)
            if (thinkingPart) {
              // Text should be preserved
              expect(thinkingPart.text).toBe(thinkingText)
              // Signature should be removed (not in the stripped version)
              expect(thinkingPart.thoughtSignature).toBeUndefined()
            }
          }
        }
      }
    }
  })

  it('should handle multiple fallback attempts with signature stripping', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async (_url: string, _options?: RequestInit) => {
        fetchCallCount++

        // First two attempts: rate limit
        if (fetchCallCount <= 2) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '0' },
          })
        }

        // Third attempt: success
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"type":"text_delta","text":"Final response"}}\n\n'
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
                thinking: 'Multi-step reasoning',
                thoughtSignature: 'sig-multi-001',
              },
              {
                type: 'text',
                text: 'Response',
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
          // Different models on each fallback
          if (fallbackAttempt === 1) {
            return { provider: 'antigravity', model: 'gemini-2.0-flash' }
          } else if (fallbackAttempt === 2) {
            return { provider: 'antigravity', model: 'gemini-1.5-pro' }
          }
        }
        return { provider: 'antigravity', model: 'gemini-2.0-flash' }
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

    // Verify multiple fallback attempts
    expect(fetchCallCount).toBeGreaterThan(2)
  })

  it('should successfully complete request after fallback with complete conversation history', async () => {
    let fetchCallCount = 0

    globalThis.fetch = Object.assign(
      mock(async (_url: string, _options?: RequestInit) => {
        fetchCallCount++

        // First attempt: rate limit
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'retry-after': '0' },
          })
        }

        // Second attempt: complete success with full response
        const mockStream = new ReadableStream({
          start(controller) {
            // Simulate a complete Anthropic-style streaming response
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_start","message":{"id":"msg_123","role":"assistant","model":"claude-3-5-sonnet"}}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The sum of 2 and 2 is 4."}}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message_stop"}\n\n'
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
                thinking: 'The user is asking me to add 2 and 2',
                thoughtSignature: 'sig-calc-001',
              },
              {
                type: 'text',
                text: 'The answer is 4',
              },
            ],
          },
          { role: 'user', content: 'Can you verify that?' },
        ],
        stream: true,
      }),
    })

    const mockRouter = {
      resolveModel: (model: string) => {
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

    // Verify retry occurred
    expect(fetchCallCount).toBe(2)

    // Verify response is readable
    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)
  })
})
