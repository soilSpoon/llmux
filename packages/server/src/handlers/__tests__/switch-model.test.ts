import { describe, expect, it, mock, spyOn } from 'bun:test'
import { TokenRefresh } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { dispatchWithRetry, type DispatchInput } from '../upstream-dispatcher'
import type { RequestBuilderInput, RequestBuilderResult } from '../upstream-request-builder'
import type { ProxyOptions } from '../types'

describe('switch-model functionality', () => {
  it('should switch provider and model when handleUpstreamError returns switch-model action', async () => {
    // Mock TokenRefresh
    const tokenRefreshSpy = spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([{
       accessToken: 'mock',
       refreshToken: 'mock', 
       expiresAt: Date.now() + 3600000 
    } as any])

    // Track which provider/model combinations were attempted
    const attemptedRequests: Array<{ provider: string; model: string }> = []

    // Mock builder that tracks attempts and simulates rate limit on first provider
    const mockBuilder = mock(
      async (input: RequestBuilderInput): Promise<RequestBuilderResult> => {
        const currentProvider = input.options.targetProvider || 'antigravity'
        const currentModel = input.options.targetModel || 'gemini-3-pro-high'

        attemptedRequests.push({
          provider: currentProvider,
          model: currentModel,
        })

        // Simulate account selection
        input.retryState.accountIndex = 0

        // Simulate successful request on second provider
        if (currentProvider === 'opencode-zen') {
          return {
            request: {
              endpoint: 'https://api.opencode-zen.example/v1/chat',
              init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: currentModel }),
              },
              meta: {
                provider: currentProvider as ProviderName,
                model: currentModel,
                originalModel: 'claude-opus-4-5-20251101',
                streaming: false,
              },
            },
            retryState: input.retryState,
          }
        }

        // First provider (antigravity) - return rate limit
        return {
          request: {
            endpoint: 'https://antigravity.example/v1/chat',
            init: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: currentModel }),
            },
            meta: {
              provider: currentProvider as ProviderName,
              model: currentModel,
              originalModel: 'claude-opus-4-5-20251101',
              streaming: false,
            },
          },
          retryState: input.retryState,
        }
      }
    )

    // Mock router that suggests fallback
    const mockRouter = {
      resolveModel: mock(async () => {
        return {
          provider: 'opencode-zen' as ProviderName,
          model: 'big-pickle',
        }
      }),
      handleRateLimit: mock(() => {}),
      handleSuccess: mock(() => {}),
    }

    // Mock fetch to simulate rate limit on antigravity, success on opencode-zen
    const originalFetch = global.fetch
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('opencode-zen')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // antigravity returns 429
      return new Response(JSON.stringify({ error: 'rate_limit' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof global.fetch

    try {
      const mockSignatureStore = {
        get: mock(() => undefined),
        set: mock(() => {}),
        delete: mock(() => {}),
        clear: mock(() => {}),
      }

      const options: ProxyOptions = {
        targetProvider: 'antigravity',
        targetModel: 'gemini-3-pro-high',
        sourceFormat: 'anthropic-messages',
        router: mockRouter as any,
      }

      const input: DispatchInput = {
        reqId: 'test-switch-model',
        builder: mockBuilder,
        initialBody: { model: 'claude-opus-4-5-20251101' },
        options,
        mode: 'non-streaming',
        signatureStore: mockSignatureStore as any,
      }

      const result = await dispatchWithRetry(input)

      // Verify that we attempted both providers
      expect(attemptedRequests.length).toBeGreaterThanOrEqual(2)
      expect(attemptedRequests[0]?.provider).toBe('antigravity')
      expect(attemptedRequests[attemptedRequests.length - 1]?.provider).toBe('opencode-zen')
      expect(attemptedRequests[attemptedRequests.length - 1]?.model).toBe('big-pickle')

      // Verify successful response
      expect(result.response).not.toBeNull()
      expect(result.response?.status).toBe(200)
      expect(result.meta?.provider).toBe('opencode-zen')
      expect(result.meta?.model).toBe('big-pickle')

      tokenRefreshSpy.mockRestore()
    } finally {
      global.fetch = originalFetch
    }
  })
})
