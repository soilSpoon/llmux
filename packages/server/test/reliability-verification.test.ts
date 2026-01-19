import { describe, expect, test, afterEach, beforeEach, mock } from 'bun:test'
import { dispatchWithRetry } from '../src/handlers/upstream-dispatcher'
import type { DispatchInput } from '../src/handlers/upstream-dispatcher'
import type { RequestBuilderResult, UpstreamRequestMeta } from '../src/handlers/upstream-request-builder'
import type { RetryState } from '../src/handlers/request-handler'
import { SignatureStore } from '../src/stores'

describe('Reliability & Observability Verification', () => {
  describe('dispatchWithRetry', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      // Reset fetch before each test
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    function createMockMeta(overrides: Partial<UpstreamRequestMeta> = {}): UpstreamRequestMeta {
      return {
        provider: 'openai',
        model: 'gpt-4',
        originalModel: 'gpt-4',
        currentProjectId: 'proj',
        streaming: false,
        ...overrides,
      }
    }

    function createMockBuilder(
      metaOverrides: Partial<UpstreamRequestMeta> = {}
    ): DispatchInput['builder'] {
      return async ({ retryState }: { retryState: RetryState }): Promise<RequestBuilderResult> => ({
        request: {
          endpoint: 'http://test.com',
          init: { method: 'POST', body: '{}' },
          meta: createMockMeta(metaOverrides),
        },
        retryState,
      })
    }

    function createMockSignatureStore(): SignatureStore {
      return new SignatureStore(':memory:')
    }

    /**
     * Sets up a mock fetch function for testing.
     * The type assertion to `unknown` then `typeof fetch` is necessary because:
     * 1. Bun's `fetch` type includes a namespace with `preconnect` method
     * 2. Bun's `Mock` type doesn't include this namespace
     * 3. This is a known limitation when mocking `fetch` in Bun tests
     */
    function setMockFetch(
      impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    ): void {
      const mockFn = mock(impl)
      globalThis.fetch = mockFn as unknown as typeof fetch
    }

    test('should retry on network error with backoff', async () => {
      let attempts = 0
      setMockFetch(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Network error')
        }
        return new Response('{"success":true}', { status: 200 })
      })

      const input: DispatchInput = {
        reqId: 'test-retry-id',
        builder: createMockBuilder(),
        initialBody: {},
        options: { sourceFormat: 'openai-chat' },
        mode: 'non-streaming',
        signatureStore: createMockSignatureStore(),
        networkErrorBaseDelayMs: 1,
        networkErrorMaxDelayMs: 5,
      }

      const result = await dispatchWithRetry(input)

      expect(attempts).toBe(3)
      expect(result.response?.status).toBe(200)
    })

    test('should use keepalive:true for non-streaming requests', async () => {
      let capturedInit: RequestInit | undefined
      setMockFetch(async (_url, init) => {
        capturedInit = init
        return new Response('ok')
      })

      const input: DispatchInput = {
        reqId: 'test-keepalive-id',
        builder: createMockBuilder(),
        initialBody: {},
        options: { sourceFormat: 'openai-chat' },
        mode: 'non-streaming',
        signatureStore: createMockSignatureStore(),
      }

      await dispatchWithRetry(input)

      expect(capturedInit?.keepalive).toBe(true)
    })

    test('should NOT use keepalive for streaming requests', async () => {
      let capturedInit: RequestInit | undefined
      setMockFetch(async (_url, init) => {
        capturedInit = init
        return new Response('ok')
      })

      const input: DispatchInput = {
        reqId: 'test-no-keepalive-id',
        builder: createMockBuilder({ streaming: true }),
        initialBody: {},
        options: { sourceFormat: 'openai-chat' },
        mode: 'streaming',
        signatureStore: createMockSignatureStore(),
      }

      await dispatchWithRetry(input)

      expect(capturedInit?.keepalive).toBeUndefined()
    })
  })
})
