import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { InMemoryRateLimitStore } from '../rate-limit-store'
import { buildUpstreamRequest } from '../upstream-request-builder'
import { TokenRefresh } from '@llmux/auth'
import { SignatureStore } from '../../stores/signature-store'

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
    afterEach(() => {
      mock.restore()
    })

    it('should throw error when no credentials available for Antigravity', async () => {
      // Use spyOn instead of mock.module to avoid global side effects
      spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([])

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
        signatureStore: new SignatureStore()
      }

      try {
        await buildUpstreamRequest(input as Parameters<typeof buildUpstreamRequest>[0])
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        // We expect the specific error message, but handle potential variations
        expect(error instanceof Error).toBe(true)
        if (error instanceof Error) {
            // The actual error message might come from TokenRefresh.ensureFresh throwing
            // or from upstream-request-builder handling the empty array
            // Let's check what actually happens.
            // If ensureFresh returns [], buildUpstreamRequest logic for Antigravity usually throws "No available accounts"
            // or "No credentials found" depending on implementation.
            
            // Actually, looking at refresh.ts:29, ensureFresh throws "No credentials found for provider" 
            // if CredentialStorage.get returns empty.
            // But here we mocked ensureFresh to return [], not throw.
            // So the caller receives [].
            
            // In prepareAntigravityRequest:
            // const credentials = await TokenRefresh.ensureFresh('antigravity')
            // if (credentials.length === 0) throw new Error('No available accounts for Antigravity')
            
            // So we expect "No available accounts" or similar.
            expect(error.message).toMatch(/No (credentials|available accounts)/i)
        }
      }
    })
  })
})
