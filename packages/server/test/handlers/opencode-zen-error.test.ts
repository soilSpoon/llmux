
import { describe, it, expect, mock } from 'bun:test'
import { OpencodeZenStrategy } from '../../src/handlers/providers/opencode-zen-strategy'
import type { ErrorContext, RetryState } from '../../src/handlers/providers/provider-strategy'
import { createRetryState } from '../../src/handlers/request-handler'
import type { Router } from '../../src/routing'

describe('OpencodeZenStrategy Error Handling', () => {
  const strategy = new OpencodeZenStrategy()
  const errorBody = JSON.stringify({
    type: 'error',
    error: {
      type: 'error',
      message: "Cannot read properties of undefined (reading 'prompt_tokens')",
    },
  })

  it('should handle specific 500 error as fallback/retry', async () => {
    // Mock router
    const mockRouter = {
      handleRateLimit: mock(),
      resolveModel: mock().mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4',
      }),
    } as unknown as Router

    const context: ErrorContext = {
      provider: 'opencode-zen',
      model: 'gpt-4',
      status: 500,
      errorText: errorBody,
      router: mockRouter,
    }

    const retryState: RetryState = createRetryState()

    if (strategy.handleError) {
      const result = await strategy.handleError(context, retryState)

      expect(result).toBeDefined()
      // Expect it to try to switch model because router found a fallback
      expect(result?.action).toBe('switch-model')
      expect(result?.newProvider).toBe('openai')
      expect(mockRouter.handleRateLimit).toHaveBeenCalled()
    } else {
      // Test fails if not implemented
      expect(strategy.handleError).toBeDefined()
    }
  })

  it('should return null for other 500 errors', async () => {
    const context: ErrorContext = {
      provider: 'opencode-zen',
      model: 'gpt-4',
      status: 500,
      errorText: 'Some other error',
    }
    const retryState = createRetryState()

    if (strategy.handleError) {
      const result = await strategy.handleError(context, retryState)
      expect(result).toBeNull()
    }
  })
})
