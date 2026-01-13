import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { InMemoryRateLimitStore } from '../rate-limit-store'
import { buildUpstreamRequest } from '../upstream-request-builder'

describe('Rate Limit Regression Tests', () => {
  describe('InMemoryRateLimitStore', () => {
    let store: InMemoryRateLimitStore

    beforeEach(() => {
      store = new InMemoryRateLimitStore()
    })

    it('should expire hard limits when expiresAt has passed', () => {
      const now = Date.now()
      store.markLimit('provider', 'account', 'family', {
        type: 'hard',
        expiresAt: now - 1000 // 1 second ago
      })

      const limit = store.getLimit('provider', 'account', 'family')
      expect(limit).toBeNull()
    })

    it('should NOT expire hard limits when expiresAt is in the future', () => {
      const now = Date.now()
      store.markLimit('provider', 'account', 'family', {
        type: 'hard',
        expiresAt: now + 10000 // 10 seconds in future
      })

      const limit = store.getLimit('provider', 'account', 'family')
      expect(limit).not.toBeNull()
      expect(limit?.type).toBe('hard')
    })

    it('should NOT expire soft limits when expiresAt is in the future', () => {
      const now = Date.now()
      store.markLimit('provider', 'account', 'family', {
        type: 'soft',
        expiresAt: now + 10000
      })

      const limit = store.getLimit('provider', 'account', 'family')
      expect(limit).not.toBeNull()
    })
  })

  describe('Unauthenticated Request Prevention', () => {
    it('should throw error when no credentials available for Antigravity', async () => {
      // Mock prepareAntigravityRequest to return null (no available accounts)
      // Note: We need to mock the internal call or ensure the context leads to null
      
      // Since it's hard to mock internal functions in Bun sometimes without more setup,
      // let's try to mock the TokenRefresh.ensureFresh which prepareAntigravityRequest calls
      mock.module('@llmux/auth', () => ({
        TokenRefresh: {
          ensureFresh: () => Promise.resolve([])
        },
        ANTIGRAVITY_ENDPOINT_FALLBACKS: ['https://test.api'],
        ANTIGRAVITY_HEADERS: {},
        isOAuthCredential: () => false,
        fetchAntigravityProjectID: () => Promise.resolve('test-project')
      }))

      const input = {
        reqId: 'test-id',
        body: { messages: [{ role: 'user', content: 'hello' }] },
        options: {
          sourceFormat: 'openai-chat',
          targetProvider: 'antigravity',
          targetModel: 'claude-3-opus'
        },
        retryState: {
          attempt: 1,
          accountIndex: -1,
          antigravityEndpointIndex: 0,
          overrideProjectId: null,
          maxRetryAttempts: 1
        },
        mode: 'non-streaming',
        signatureStore: {} as any
      }

      // We expect buildUpstreamRequest to throw the new error we added
      try {
        await buildUpstreamRequest(input as any)
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('No credentials available for Antigravity')
      }
    })
  })
})
