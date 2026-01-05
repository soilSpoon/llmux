import { describe, expect, it, mock } from 'bun:test'
import { dispatchWithRetry, type DispatchInput, NonRetriableError } from '../../src/handlers/upstream-dispatcher'
import { createRetryState } from '../../src/handlers/request-handler'
import { SignatureStore } from '../../src/stores'

// Mocks
mock.module('../../src/handlers/request-handler', () => ({
  createRetryState: () => ({
    attempt: 0,
    maxRetryAttempts: 3,
    accountIndex: 0,
    antigravityEndpointIndex: 0
  }),
  shouldContinueRetry: (s: any) => s.attempt < s.maxRetryAttempts,
  incrementAttempt: (s: any) => { s.attempt++ },
  handleUpstreamError: async (ctx: any) => {
    if (ctx.status === 429) return { action: 'retry', delay: 10 }
    if (ctx.status === 500) return { action: 'throw' }
    return { action: 'throw' }
  },
  rotateAntigravityEndpoint: () => {},
  parseRetryAfterMs: () => 1000,
  prepareRequestContext: async () => ({})
}))

mock.module('../../src/upstream', () => ({
  parseRetryAfterMs: () => 1000
}))

describe('Upstream Dispatcher', () => {
  const mockSignatureStore = new SignatureStore()
  const mockBuilder = mock()

  it('dispatches request and returns successful response', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 })
    global.fetch = mock(() => Promise.resolve(mockResponse)) as any

    mockBuilder.mockResolvedValue({
      request: {
        endpoint: 'https://api.test',
        init: { method: 'POST', body: '{}' },
        meta: { provider: 'openai', model: 'gpt-4' }
      },
      retryState: createRetryState()
    })

    const input: DispatchInput = {
      reqId: 'test-req',
      builder: mockBuilder,
      initialBody: {},
      options: {} as any,
      mode: 'non-streaming',
      signatureStore: mockSignatureStore
    }

    const result = await dispatchWithRetry(input)

    expect(result.response?.status).toBe(200)
    expect(mockBuilder).toHaveBeenCalledTimes(1)
  })

  it('retries on 429', async () => {
    const failResponse = new Response('Too Many Requests', { status: 429 })
    const successResponse = new Response('OK', { status: 200 })

    global.fetch = mock()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse) as any

    mockBuilder.mockResolvedValue({
      request: {
        endpoint: 'https://api.test',
        init: { method: 'POST', body: '{}' },
        meta: { provider: 'openai', model: 'gpt-4' }
      },
      retryState: createRetryState()
    })

    const input: DispatchInput = {
      reqId: 'test-req',
      builder: mockBuilder,
      initialBody: {},
      options: {} as any,
      mode: 'non-streaming',
      signatureStore: mockSignatureStore
    }

    const result = await dispatchWithRetry(input)

    expect(result.response?.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws NonRetriableError on fatal error', async () => {
    const errorResponse = new Response('Internal Error', { status: 500 })
    global.fetch = mock().mockResolvedValue(errorResponse) as any

    mockBuilder.mockResolvedValue({
      request: {
        endpoint: 'https://api.test',
        init: { method: 'POST', body: '{}' },
        meta: { provider: 'openai', model: 'gpt-4' }
      },
      retryState: createRetryState()
    })

    const input: DispatchInput = {
      reqId: 'test-req',
      builder: mockBuilder,
      initialBody: {},
      options: {} as any,
      mode: 'non-streaming',
      signatureStore: mockSignatureStore
    }

    try {
      await dispatchWithRetry(input)
      throw new Error('Should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(NonRetriableError)
      expect(e.errorInfo.status).toBe(500)
    }
  })
})
