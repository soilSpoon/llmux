
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { executeUpstream } from '../upstream-executor'
import { AllCooldownError } from '../upstream-dispatcher'
import type { ProxyOptions } from '../types'

// Mock the upstream-request-builder to throw AllCooldownError simulate Router blocking everything
mock.module('../upstream-request-builder', () => ({
  buildUpstreamRequest: async () => {
    throw new AllCooldownError('All available models and providers are currently in cooldown')
  }
}))

describe('upstream-executor reproduction', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('should return 429 response when AllCooldownError occurs, instead of throwing "No response from dispatcher"', async () => {
    // We cast to ProxyOptions to ensure type safety without 'as any' for the whole object if possible.
    // However, sourceFormat expects a specific union type. 
    // We assume 'openai-chat' is valid. If not, typecheck will fail and we will fix it.
    const options = {
      sourceFormat: 'openai-chat',
      targetProvider: 'antigravity',
      targetModel: 'test-model',
    } satisfies ProxyOptions

    const result = await executeUpstream({
      reqId: 'test-req-id',
      body: { model: 'test-model' },
      options,
      mode: 'non-streaming',
    })

    expect(result).toBeDefined()
    expect(result.response.status).toBe(429)
    expect(result.meta).toBeDefined()
    
    const errorBody = await result.response.json() as { error: { code: string } }
    expect(errorBody.error.code).toBe('all_providers_cooldown')
  })
})
