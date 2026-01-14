import { describe, expect, it, mock, afterEach, spyOn } from 'bun:test'
import * as requestHandlerModule from '../../src/handlers/request-handler'
import { dispatchWithRetry } from '../../src/handlers/upstream-dispatcher'
import { AllCooldownError } from '../../src/handlers/error-utils'
import { SignatureStore } from '../../src/stores'



describe('Retry & Cooldown Integration', () => {
  const signatureStore = new SignatureStore()
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    mock.restore()
  })

  it('preserves attempt count when switching models', async () => {
    const handleUpstreamErrorSpy = spyOn(requestHandlerModule, 'handleUpstreamError')
    const retryState = requestHandlerModule.createRetryState(5)
    
    handleUpstreamErrorSpy.mockImplementation(async (ctx: any) => {
      if (ctx.retryState.attempt === 1) {
        return { action: 'switch-model', newModel: 'fallback-model', newProvider: 'openai' }
      }
      return { action: 'throw' }
    })

    const mockBuilder = mock().mockImplementation(async (input) => ({
      request: {
        endpoint: 'https://api.test',
        init: { method: 'POST', body: '{}' },
        meta: { provider: 'anthropic', model: 'claude-3', originalModel: 'claude-3' }
      },
      retryState: input.retryState
    }))

    global.fetch = mock().mockResolvedValue(new Response('Error', { status: 429 })) as any

    try {
      await dispatchWithRetry({
        reqId: 'test',
        builder: mockBuilder,
        initialBody: {},
        options: { 
          router: { 
            getMaxRetryAttempts: () => 5, 
            handleRateLimit: () => {},
            isAvailable: () => true 
          } 
        } as any,
        mode: 'non-streaming',
        signatureStore,
        retryState
      })
    } catch (e) {
      // Expected throw
    }

    expect(retryState.attempt).toBe(2)
  })

  it('triggers router fallback on AllCooldownError in dispatcher', async () => {
    const mockRouter = {
      handleRateLimit: mock(),
      resolveModel: mock(),
      isAvailable: () => true,
      getMaxRetryAttempts: () => 10
    }

    const mockBuilder = mock().mockImplementationOnce(async () => {
      throw new AllCooldownError('all cooling down', 'anthropic', 'claude-3')
    }).mockImplementationOnce(async () => {
      return {
        request: {
          endpoint: 'https://api.test-fallback',
          init: { method: 'POST', body: '{}' },
          meta: { provider: 'openai', model: 'gpt-4', originalModel: 'claude-3' }
        },
        retryState: requestHandlerModule.createRetryState()
      }
    })

    global.fetch = mock().mockResolvedValue(new Response('OK', { status: 200 })) as any

    const result = await dispatchWithRetry({
      reqId: 'test-cooldown',
      builder: mockBuilder,
      initialBody: {},
      options: { router: mockRouter as any } as any,
      mode: 'non-streaming',
      signatureStore,
    })

    expect(mockRouter.handleRateLimit).toHaveBeenCalledWith('claude-3')
    expect(result.response?.status).toBe(200)
    expect(mockBuilder).toHaveBeenCalledTimes(2)
  })

  it('stops retry loop when max attempts reached even with AllCooldownError', async () => {
    const mockRouter = {
      handleRateLimit: mock(),
      resolveModel: mock(),
      isAvailable: () => true,
      getMaxRetryAttempts: () => 2
    }

    const mockBuilder = mock().mockImplementation(async () => {
      throw new AllCooldownError('always cooling down', 'anthropic', 'claude-3')
    })

    const result = await dispatchWithRetry({
      reqId: 'test-max-retry',
      builder: mockBuilder,
      initialBody: {},
      options: { router: mockRouter as any } as any,
      mode: 'non-streaming',
      signatureStore,
    })

    expect(result.response?.status).toBe(429)
    expect(mockBuilder).toHaveBeenCalledTimes(2) 
  })
})
