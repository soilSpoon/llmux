import { describe, expect, it } from 'bun:test'
import {
  type RequestBuilderInput,
  buildUpstreamRequest,
} from '../../src/handlers/upstream-request-builder'
import { SignatureStore } from '../../src/stores'
import { createRetryState } from '../../src/handlers/request-handler'
import '../../test/setup' // Load setup to register providers

describe('Upstream Request Builder', () => {
  const mockSignatureStore = new SignatureStore()

  it('builds a basic request for generic provider', async () => {
    const input: RequestBuilderInput = {
      reqId: 'test-req',
      body: { model: 'gpt-4o', messages: [] },
      options: {
        sourceFormat: 'openai',
        targetProvider: 'openai',
        targetModel: 'gpt-4o',
        apiKey: 'dummy-key' // Provide API key to avoid auth refresh logic
      },
      retryState: createRetryState(),
      mode: 'non-streaming',
      signatureStore: mockSignatureStore
    }

    const result = await buildUpstreamRequest(input)

    // Expect real endpoint as we removed mocks
    expect(result.request.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(result.request.meta.provider).toBe('openai')
    expect(result.request.meta.model).toBe('gpt-4o')
    expect(result.request.init.method).toBe('POST')
    
    // Check Authorization header (due to apiKey)
    expect(result.request.init.headers).toHaveProperty('Authorization', 'Bearer dummy-key')
    
    expect(JSON.parse(result.request.init.body)).toHaveProperty('model', 'gpt-4o')
  })
})
