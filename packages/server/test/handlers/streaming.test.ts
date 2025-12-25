import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import '../setup'
import {
  handleStreamingProxy,
  type ProxyOptions,
} from '../../src/handlers/streaming'

describe('handleStreamingProxy', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns streaming response with correct content type', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n'
          )
        )
        controller.close()
      },
    })

    globalThis.fetch = mock(async () => {
      return new Response(mockStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    })

    const options: ProxyOptions = {
      sourceFormat: 'openai',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
    }

    const response = await handleStreamingProxy(request, options)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
  })

  test('handles network errors in streaming', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Stream connection failed')
    })

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    })

    const options: ProxyOptions = {
      sourceFormat: 'openai',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.status).toBe(502)
  })

  test('handles upstream error response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    })

    const options: ProxyOptions = {
      sourceFormat: 'openai',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.status).toBe(429)
  })

  test('streams transformed chunks', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-3","stop_reason":null}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      },
    })

    globalThis.fetch = mock(async () => {
      return new Response(mockStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    })

    const options: ProxyOptions = {
      sourceFormat: 'openai',
      targetProvider: 'anthropic',
      apiKey: 'test-key',
    }

    const response = await handleStreamingProxy(request, options)
    expect(response.body).not.toBeNull()

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }

    expect(fullText).toContain('data:')
  })
})
