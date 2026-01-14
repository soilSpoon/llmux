import { describe, expect, it, beforeEach, mock } from 'bun:test'
import { AntigravityStrategy } from '../../src/handlers/providers/antigravity-strategy'
import type { StreamEventContext, StreamCompleteContext } from '../../src/handlers/providers/provider-strategy'

describe('AntigravityStrategy Streaming Hooks', () => {
  let strategy: AntigravityStrategy

  beforeEach(() => {
    strategy = new AntigravityStrategy()
  })

  describe('handleStreamEvent', () => {
    it('should extract and record signatures from real SSE data', () => {
      // Use raw JSON because the strategy prepends 'data: '
      const event = '{"thoughtSignature": "hook_sig_123"}'
      const state = { accumulatedSignatures: [] as string[] }
      
      const mockSignatureStore = {
        saveSignature: mock(() => {})
      }
      
      const context = {
        signatureContext: {
          sessionId: 'test-session',
          projectId: 'p1',
          provider: 'p',
          endpoint: 'e',
          account: 'a',
          signatureStore: mockSignatureStore
        }
      }
      
      strategy.handleStreamEvent({
        event,
        context,
        state
      } as unknown as StreamEventContext)

      expect(state.accumulatedSignatures).toContain('hook_sig_123')
      expect(mockSignatureStore.saveSignature).toHaveBeenCalled()
    })

    it('should ignore events without signatures', () => {
      const state = { accumulatedSignatures: [] as string[] }
      const context = {
        signatureContext: {
           signatureStore: { saveSignature: mock(() => {}) }
        }
      }
      
      strategy.handleStreamEvent({
        event: '{"content": "hello"}',
        context,
        state
      } as unknown as StreamEventContext)

      expect(state.accumulatedSignatures).toHaveLength(0)
    })
  })

  describe('onStreamComplete', () => {
    it('should cache thinking when requirements are met', () => {
      const mockStore = {
        save: (session: any, sig: string, family: string, thinking: string) => {
          mockStore.calledWith = { session, sig, family, thinking }
        },
        calledWith: null as any
      }
      
      const state = {
        accumulatedThinking: 'thinking process',
        accumulatedSignatures: ['sig123'],
        finalModel: 'claude-3-5-sonnet',
        targetModel: 'claude-3-5-sonnet'
      }
      
      const signatureCache = { store: mockStore.save.bind(mockStore) }
      const context = {
        signatureContext: {
          sessionId: 'test-session',
          signatureCache
        }
      }

      strategy.onStreamComplete({
        context,
        state,
        reqId: 'req-123'
      } as unknown as StreamCompleteContext)

      expect(mockStore.calledWith).toBeDefined()
      expect(mockStore.calledWith.sig).toBe('sig123')
    })
  })
})
