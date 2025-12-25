import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { startServer, type LlmuxServer, type AmpConfig } from '../../src/server'
import { type ProviderChecker } from '../../src/handlers/fallback'
import type { ProviderHandlers } from '../../src/amp/routes'

describe('Amp Integration Tests', () => {
  let server: LlmuxServer | null = null
  let mockUpstream: ReturnType<typeof Bun.serve> | null = null
  let mockUpstreamUrl: string = ''
  const upstreamRequests: Array<{ path: string; method: string; body: unknown }> = []

  beforeAll(() => {
    mockUpstream = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url)
        let body: unknown = null
        if (req.method === 'POST') {
          try {
            body = await req.json()
          } catch {
            body = await req.text()
          }
        }
        upstreamRequests.push({ path: url.pathname, method: req.method, body })

        return new Response(
          JSON.stringify({
            id: 'chatcmpl-upstream',
            object: 'chat.completion',
            model: (body as any)?.model ?? 'unknown',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Response from upstream (ampcode.com)' },
                finish_reason: 'stop',
              },
            ],
            source: 'upstream',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      },
    })
    mockUpstreamUrl = `http://localhost:${mockUpstream.port}`
  })

  afterAll(() => {
    mockUpstream?.stop()
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    upstreamRequests.length = 0
  })

  describe('E2E: Local Provider Available', () => {
    test('should handle request with local provider end-to-end', async () => {
      const localModels = new Set(['gpt-4o', 'gpt-4o-mini'])
      const providerChecker: ProviderChecker = (model) => localModels.has(model)

      const handlers: ProviderHandlers = {
        openai: async (req) => {
          const body = await req.json() as { model: string }
          return new Response(
            JSON.stringify({
              id: 'chatcmpl-local',
              object: 'chat.completion',
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Response from local provider' },
                  finish_reason: 'stop',
                },
              ],
              source: 'local',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        },
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json() as { source: string; model: string; choices: Array<{ message: { content: string } }> }

      expect(data.source).toBe('local')
      expect(data.model).toBe('gpt-4o')
      expect(data.choices[0]?.message.content).toBe('Response from local provider')
      expect(upstreamRequests.length).toBe(0)
    })

    test('should use local anthropic provider for claude models', async () => {
      const localModels = new Set(['claude-sonnet-4-20250514'])
      const providerChecker: ProviderChecker = (model) => localModels.has(model)

      const handlers: ProviderHandlers = {
        anthropic: async (req) => {
          const body = await req.json() as { model: string }
          return new Response(
            JSON.stringify({
              id: 'msg-local',
              type: 'message',
              model: body.model,
              content: [{ type: 'text', text: 'Local Anthropic response' }],
              source: 'local',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        },
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(
        `http://localhost:${server.port}/api/provider/anthropic/v1/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json() as { source: string }

      expect(data.source).toBe('local')
      expect(upstreamRequests.length).toBe(0)
    })
  })

  describe('E2E: Upstream Fallback', () => {
    test('should fallback to upstream when no local provider', async () => {
      const providerChecker: ProviderChecker = () => false // No local providers

      const handlers: ProviderHandlers = {
        openai: async () => new Response('should not be called'),
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json() as { source: string }

      expect(data.source).toBe('upstream')
      expect(upstreamRequests.length).toBe(1)
      expect(upstreamRequests[0]!.path).toBe('/api/provider/openai/v1/chat/completions')
    })

    test('should forward request body to upstream correctly', async () => {
      const providerChecker: ProviderChecker = () => false

      const handlers: ProviderHandlers = {
        openai: async () => new Response('unused'),
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const requestBody = {
        model: 'o1-preview',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Explain quantum computing' },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }

      await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      )

      expect(upstreamRequests.length).toBe(1)
      expect(upstreamRequests[0]!.body).toEqual(requestBody)
    })
  })

  describe('E2E: No Provider and No Upstream', () => {
    test('should return 503 when no provider and no upstream configured', async () => {
      const providerChecker: ProviderChecker = () => false

      const handlers: ProviderHandlers = {
        openai: async () => new Response('unused'),
      }

      const ampConfig: AmpConfig = {
        handlers,
        providerChecker,
        // No upstreamUrl configured
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'unknown-model',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        }
      )

      expect(response.status).toBe(503)
      const data = await response.json() as { error: string }
      expect(data.error).toContain('No provider available')
    })
  })

  describe('E2E: Mixed Provider Availability', () => {
    test('should route to local for available models, upstream for others', async () => {
      const localModels = new Set(['gpt-4o-mini'])
      const providerChecker: ProviderChecker = (model) => localModels.has(model)

      const handlers: ProviderHandlers = {
        openai: async (req) => {
          const body = await req.json() as { model: string }
          return new Response(
            JSON.stringify({ source: 'local', model: body.model }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        },
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      // Request 1: local model
      const localResponse = await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
        }
      )
      const localData = await localResponse.json() as { source: string }
      expect(localData.source).toBe('local')

      // Request 2: upstream model
      const upstreamResponse = await fetch(
        `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'o1-pro', messages: [] }),
        }
      )
      const upstreamData = await upstreamResponse.json() as { source: string }
      expect(upstreamData.source).toBe('upstream')

      expect(upstreamRequests.length).toBe(1)
    })
  })

  describe('E2E: Gemini Routes', () => {
    test('should handle Gemini generateContent route', async () => {
      const localModels = new Set(['gemini-2.0-flash'])
      const providerChecker: ProviderChecker = (model) => localModels.has(model)

      const handlers: ProviderHandlers = {
        google: async (_req, params) => {
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }],
              source: 'local',
              action: params?.action,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        },
      }

      const ampConfig: AmpConfig = {
        handlers,
        upstreamUrl: mockUpstreamUrl,
        providerChecker,
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(
        `http://localhost:${server.port}/v1beta/models/gemini-2.0-flash:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }] }),
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json() as { source: string; action: string }

      expect(data.source).toBe('local')
      expect(data.action).toBe('gemini-2.0-flash:generateContent')
    })
  })

  describe('E2E: Default Routes Still Work', () => {
    test('should serve /health endpoint when amp is enabled', async () => {
      const ampConfig: AmpConfig = {
        handlers: { openai: async () => new Response('ok') },
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(`http://localhost:${server.port}/health`)
      expect(response.ok).toBe(true)

      const data = await response.json() as { status: string }
      expect(data.status).toBe('ok')
    })

    test('should serve /providers endpoint when amp is enabled', async () => {
      const ampConfig: AmpConfig = {
        handlers: { openai: async () => new Response('ok') },
      }

      server = await startServer({ port: 0, amp: ampConfig })

      const response = await fetch(`http://localhost:${server.port}/providers`)
      expect(response.ok).toBe(true)

      const data = await response.json() as { providers: unknown }
      expect(data.providers).toBeDefined()
    })
  })
})
