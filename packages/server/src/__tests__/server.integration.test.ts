import { afterEach, describe, expect, it, mock } from 'bun:test'
import '../../test/setup'
import type { BodyInit } from 'bun'
import { type LlmuxServer, startServer } from '../server'

describe('Server Integration: modelMappings', () => {
  let server: LlmuxServer
  let capturedBody: unknown
  let originalFetch: typeof globalThis.fetch

  function setupFetchMock(responseBody?: unknown, contentType = 'application/json') {
    originalFetch = globalThis.fetch
    capturedBody = undefined
    const mockResponse =
      responseBody ??
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    globalThis.fetch = Object.assign(
      mock(async (url: unknown, options?: { body?: string }) => {
        const urlStr = String(url)
        if (urlStr.includes('localhost')) {
          return originalFetch(url as Parameters<typeof fetch>[0], options as RequestInit)
        }
        if (options?.body) {
          capturedBody = JSON.parse(options.body)
        }
        return new Response(mockResponse as BodyInit, {
          headers: { 'Content-Type': contentType },
        })
      }),
      { preconnect: () => {} }
    ) as typeof fetch
  }

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (server) {
      await server.stop()
    }
  })

  describe('POST /v1/chat/completions', () => {
    it('config의 modelMappings가 proxy 요청에 적용된다', async () => {
      setupFetchMock()
      server = await startServer({
        port: 0,
        amp: {
          handlers: {},
          modelMappings: [{ from: 'claude-opus-4-5-20251101', to: 'gemini-claude-opus' }],
        },
      })

      const response = await globalThis.fetch(
        `http://localhost:${server.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
            'X-Target-Provider': 'openai',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-5-20251101',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.status).toBe(200)
      expect(capturedBody).toMatchObject({ model: 'gemini-claude-opus' })
    })

    it('modelMappings가 없으면 원본 model이 유지된다', async () => {
      setupFetchMock()
      server = await startServer({
        port: 0,
        amp: {
          handlers: {},
        },
      })

      const response = await globalThis.fetch(
        `http://localhost:${server.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
            'X-Target-Provider': 'openai',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.status).toBe(200)
      expect(capturedBody).toMatchObject({ model: 'gpt-4' })
    })
  })

  describe('POST /v1/messages (Anthropic format)', () => {
    it('modelMappings가 Anthropic 형식 요청에도 적용된다', async () => {
      setupFetchMock()
      server = await startServer({
        port: 0,
        amp: {
          handlers: {},
          modelMappings: [{ from: 'claude-3', to: 'mapped-claude-3' }],
        },
      })

      const response = await globalThis.fetch(`http://localhost:${server.port}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
          'X-Target-Provider': 'openai',
        },
        body: JSON.stringify({
          model: 'claude-3',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        }),
      })

      expect(response.status).toBe(200)
      expect(capturedBody).toMatchObject({ model: 'mapped-claude-3' })
    })
  })

  describe('POST /v1/chat/completions with stream', () => {
    it('streaming 요청에도 modelMappings가 적용된다', async () => {
      setupFetchMock(
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n',
        'text/event-stream'
      )

      server = await startServer({
        port: 0,
        amp: {
          handlers: {},
          modelMappings: [{ from: 'claude-stream', to: 'mapped-stream' }],
        },
      })

      const response = await globalThis.fetch(
        `http://localhost:${server.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-key',
            'X-Target-Provider': 'openai',
          },
          body: JSON.stringify({
            model: 'claude-stream',
            messages: [{ role: 'user', content: 'Hello' }],
            stream: true,
          }),
        }
      )

      expect(response.status).toBe(200)
      expect(capturedBody).toMatchObject({
        model: 'mapped-stream',
        stream: true,
      })
    })
  })
})
