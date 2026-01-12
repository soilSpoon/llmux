
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  dispatchWithRetry,
  AllCooldownError,
  type DispatchInput,
} from '../upstream-dispatcher'
import { SignatureStore } from '../../stores'

// Mock dependencies
const mockSignatureStore = new SignatureStore()

describe('upstream-dispatcher', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('should return 429 immediately when Router throws AllCooldownError', async () => {
    // Mock builder that throws AllCooldownError
    const mockBuilder = mock().mockImplementation(async () => {
      throw new AllCooldownError('All available models and providers are currently in cooldown')
    })

    const input: DispatchInput = {
      reqId: 'test-req-id',
      builder: mockBuilder,
      initialBody: { model: 'test-model' },
      options: {
        sourceFormat: 'openai' as any,
        targetProvider: 'antigravity',
        targetModel: 'test-model',
      },
      mode: 'non-streaming',
      signatureStore: mockSignatureStore,
    }

    const result = await dispatchWithRetry(input)

    // Check response
    expect(result.response).not.toBeNull()
    expect(result.response?.status).toBe(429)

    const responseBody = await result.response?.json()
    expect(responseBody).toEqual({
      error: {
        message: 'All available models and providers are currently in cooldown',
        type: 'rate_limit_error',
        code: 'all_providers_cooldown',
      },
    })

    // Check retry state - should ideally be attempt 1 (failed immediately)
    expect(result.retryState.attempt).toBe(1)
    
    // Ensure builder was called only once
    expect(mockBuilder).toHaveBeenCalledTimes(1)
  })
})
