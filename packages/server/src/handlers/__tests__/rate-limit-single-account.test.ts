import { describe, it, expect, mock } from 'bun:test'
import '../../../test/setup'
import { handleUpstreamError } from '../rate-limit-handler'
import { createRetryState } from '../request-handler'
import type { ErrorHandlingContext } from '../types'
import { Router } from '../../routing/router'
import type { ProviderName } from '@llmux/core'

describe('Rate Limit Handler - Single Account Fallback', () => {
  it('should trigger router fallback when accountIndex is -1 (no rotation)', async () => {
    // Mock Router
    const mockRouter = {
      handleRateLimit: mock(() => {}),
      resolveModel: mock(async () => ({
        provider: 'openai' as ProviderName, // Use valid provider name
        model: 'fallback-model'
      }))
    } as unknown as Router

    const retryState = createRetryState()
    retryState.accountIndex = -1 // Simulate generic provider / no rotation
    retryState.attempt = 1

    const context: ErrorHandlingContext = {
      reqId: 'test-req-id',
      provider: 'opencode-zen',
      model: 'big-pickle',
      status: 429,
      errorText: 'Rate limit exceeded',
      retryState,
      router: mockRouter,
      retryAfterMs: 1000
    }

    const result = await handleUpstreamError(context)

    // Verification
    expect(mockRouter.handleRateLimit).toHaveBeenCalledWith('big-pickle', 1000)
    expect(mockRouter.resolveModel).toHaveBeenCalledWith('big-pickle')
    
    // It should switch model because fallback was available
    expect(result).toEqual({
      action: 'switch-model',
      newModel: 'fallback-model',
      newProvider: 'openai'
    })
  })

  it('should return all-cooldown if router finds no alternative', async () => {
    // Mock Router resolving to SAME model (meaning no other options)
    const mockRouter = {
      handleRateLimit: mock(() => {}),
      resolveModel: mock(async () => ({
        provider: 'opencode-zen' as ProviderName, // Same provider
        model: 'big-pickle'       // Same model
      }))
    } as unknown as Router

    const retryState = createRetryState()
    retryState.accountIndex = -1

    const context: ErrorHandlingContext = {
      reqId: 'test-req-id-2',
      provider: 'opencode-zen',
      model: 'big-pickle',
      status: 429,
      errorText: 'Rate limit exceeded',
      retryState,
      router: mockRouter,
      retryAfterMs: 1000
    }

    const result = await handleUpstreamError(context)

    expect(mockRouter.handleRateLimit).toHaveBeenCalled()
    // Should NOT retry, should return all-cooldown (429 to client)
    expect(result).toEqual({ 
      action: 'all-cooldown',
      reason: 'Rate limit exceeded'
    })
  })
})
