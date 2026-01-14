import { describe, it, expect, mock } from 'bun:test'
import { OpencodeZenErrorStrategy } from '../../src/strategies/opencode-zen/error'
import type { ErrorHandlingOptions } from '@llmux/core/types/provider-strategies'
import type { Router } from '../../src/routing'

describe('OpencodeZenErrorStrategy', () => {
  const strategy = new OpencodeZenErrorStrategy()
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

    const options: ErrorHandlingOptions & { router: Router; reqId: string } = {
      provider: 'opencode-zen',
      model: 'gpt-4',
      status: 500,
      errorText: errorBody,
      router: mockRouter,
      reqId: 'test-req',
    }

    const result = await strategy.handleError(options)

    expect(result).toBeDefined()
    // Expect it to try to switch model because router found a fallback
    expect(result?.action).toBe('switch-model')
    expect(result?.newProvider).toBe('openai')
    expect(mockRouter.handleRateLimit).toHaveBeenCalled()
  })

  it('should return all-cooldown when router has no fallback', async () => {
    const mockRouter = {
      handleRateLimit: mock(),
      resolveModel: mock().mockResolvedValue({
        provider: 'opencode-zen',
        model: 'gpt-4',
      }),
    } as unknown as Router

    const options: ErrorHandlingOptions & { router: Router; reqId: string } = {
      provider: 'opencode-zen',
      model: 'gpt-4',
      status: 500,
      errorText: errorBody,
      router: mockRouter,
      reqId: 'test-req',
    }

    const result = await strategy.handleError(options)

    expect(result).toBeDefined()
    expect(result?.action).toBe('all-cooldown')
    expect(mockRouter.handleRateLimit).toHaveBeenCalled()
  })

  it('should return null for other 500 errors', async () => {
    const options: ErrorHandlingOptions = {
      provider: 'opencode-zen',
      model: 'gpt-4',
      status: 500,
      errorText: 'Some other error',
    }
    const result = await strategy.handleError(options)
    expect(result).toBeNull()
  })
})
