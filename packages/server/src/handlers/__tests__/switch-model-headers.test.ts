import { describe, expect, it, mock, spyOn } from 'bun:test'
import { TokenRefresh } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { dispatchWithRetry, type DispatchInput } from '../upstream-dispatcher'
import type { RequestBuilderInput, RequestBuilderResult } from '../upstream-request-builder'
import type { ProxyOptions } from '../types'
import { familyRateLimitManager } from '../family-rate-limiting'

describe('switch-model functionality - antigravity to gemini-cli', () => {
  it('should switch from antigravity to gemini-cli with correct headers', async () => {
    // Reset singleton state
    familyRateLimitManager.clear()

    // Mock TokenRefresh to ensure rate limit check passes
    const tokenRefreshSpy = spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([{
       accessToken: 'mock',
       refreshToken: 'mock', 
       expiresAt: Date.now() + 3600000 
    } as any])

    // Track requests with their headers
    const attemptedRequests: Array<{
      provider: string
      model: string
      headers: Record<string, string>
    }> = []

    // Mock builder that tracks attempts and returns different headers per provider
    const mockBuilder = mock(
      async (input: RequestBuilderInput): Promise<RequestBuilderResult> => {
        const currentProvider = input.options.targetProvider || 'antigravity'
        const currentModel = input.options.targetModel || 'claude-opus-4-5-thinking'

        // Simulate different headers for different providers
        let headers: Record<string, string>
        if (currentProvider === 'gemini-cli') {
          // Gemini CLI headers (no x-goog-user-project)
          headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'google-api-nodejs-client/9.15.1',
            'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
            'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
            Authorization: 'Bearer mock-token',
          }
        } else {
          // Antigravity headers (with x-goog-user-project)
          headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/1.11.5 windows/amd64',
            'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
            'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
            'x-goog-user-project': 'mock-project-id',
            Authorization: 'Bearer mock-token',
          }
        }

        attemptedRequests.push({
          provider: currentProvider,
          model: currentModel,
          headers,
        })

        // Simulate successful request on gemini-cli
        if (currentProvider === 'gemini-cli') {
          return {
            request: {
              endpoint: 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
              init: {
                method: 'POST',
                headers,
                body: JSON.stringify({ model: currentModel }),
              },
              meta: {
                provider: currentProvider as ProviderName,
                model: currentModel,
                originalModel: 'claude-opus-4-5-20251101',
                streaming: true,
              },
            },
            retryState: input.retryState,
          }
        }

        // Antigravity - return rate limit
        return {
          request: {
            endpoint: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
            init: {
              method: 'POST',
              headers,
              body: JSON.stringify({ model: currentModel }),
            },
            meta: {
              provider: currentProvider as ProviderName,
              model: currentModel,
              originalModel: 'claude-opus-4-5-20251101',
              streaming: true,
            },
          },
          retryState: input.retryState,
        }
      }
    )

    // Mock router that suggests gemini-cli fallback
    const mockRouter = {
      resolveModel: mock(async () => {
        return {
          provider: 'gemini-cli' as ProviderName,
          model: 'gemini-3-pro-preview',
        }
      }),
      handleRateLimit: mock(() => {}),
      handleSuccess: mock(() => {}),
    }

    // Mock fetch to simulate rate limit on antigravity, success on gemini-cli
    const originalFetch = global.fetch
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('cloudcode-pa.googleapis.com')) {
        // gemini-cli endpoint - success
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
        targetModel: 'claude-opus-4-5-thinking',
        sourceFormat: 'anthropic-messages',
        router: mockRouter as any,
      }

      const input: DispatchInput = {
        reqId: 'test-antigravity-to-gemini-cli',
        builder: mockBuilder,
        initialBody: { model: 'claude-opus-4-5-20251101' },
        options,
        mode: 'streaming',
        signatureStore: mockSignatureStore as any,
      }

      const result = await dispatchWithRetry(input)

      // Clean up spy
      tokenRefreshSpy.mockRestore()

      // Verify that we attempted both providers
      expect(attemptedRequests.length).toBeGreaterThanOrEqual(2)

      // First attempt should be antigravity
      const firstAttempt = attemptedRequests[0]
      expect(firstAttempt?.provider).toBe('antigravity')
      expect(firstAttempt?.headers['User-Agent']).toBe('antigravity/1.11.5 windows/amd64')
      expect(firstAttempt?.headers['x-goog-user-project']).toBe('mock-project-id')

      // Last attempt should be gemini-cli with different headers
      const lastAttempt = attemptedRequests[attemptedRequests.length - 1]
      expect(lastAttempt?.provider).toBe('gemini-cli')
      expect(lastAttempt?.model).toBe('gemini-3-pro-preview')
      expect(lastAttempt?.headers['User-Agent']).toBe('google-api-nodejs-client/9.15.1')
      expect(lastAttempt?.headers['x-goog-user-project']).toBeUndefined()

      // Verify successful response
      expect(result.response).not.toBeNull()
      expect(result.response?.status).toBe(200)
      expect(result.meta?.provider).toBe('gemini-cli')
      expect(result.meta?.model).toBe('gemini-3-pro-preview')
    } finally {
      global.fetch = originalFetch
    }
  })
})
