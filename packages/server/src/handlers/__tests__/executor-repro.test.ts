
import { describe, it, expect, mock, beforeEach, spyOn, afterEach } from 'bun:test'
import { executeUpstream } from '../upstream-executor'
import { AllCooldownError } from '../error-utils'
import type { ProxyOptions } from '../types'
import * as UpstreamRequestBuilder from '../upstream-request-builder'

describe('upstream-executor reproduction', () => {
  beforeEach(() => {
    //
  })

  afterEach(() => {
    mock.restore()
  })

  it('should return 429 response when AllCooldownError occurs, instead of throwing "No response from dispatcher"', async () => {
    spyOn(UpstreamRequestBuilder, 'buildUpstreamRequest').mockImplementation(async () => {
        throw new AllCooldownError('All available models and providers are currently in cooldown')
    })

    const options = {
      sourceFormat: 'openai-chat',
      targetProvider: 'antigravity',
      targetModel: 'test-model',
    } as unknown as ProxyOptions

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
