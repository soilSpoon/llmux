import { describe, expect, it, mock } from 'bun:test'
import {
  type RequestBuilderInput,
  buildUpstreamRequest,
} from '../../src/handlers/upstream-request-builder'
import { SignatureStore } from '../../src/stores'
import { createRetryState } from '../../src/handlers/request-handler'

// Mocks
mock.module('@llmux/auth', () => ({
  ANTIGRAVITY_ENDPOINT_FALLBACKS: ['https://antigravity.test/stream'],
  ANTIGRAVITY_API_PATH_STREAM: '',
  AuthProviderRegistry: {
    get: () => null
  },
  TokenRefresh: {
    ensureFresh: async () => []
  }
}))

mock.module('../../src/providers', () => ({
  prepareAntigravityRequest: async () => null,
  prepareOpenAIWebRequest: async () => null,
  buildCodexBody: async (opts: any) => ({ ...opts, codex: true }),
  fixOpencodeZenBody: () => {},
  resolveOpencodeZenProtocol: () => null,
  getOpencodeZenEndpoint: () => 'https://zen.test',
  isLicenseError: () => false,
  shouldFallbackToDefaultProject: () => false,
  ANTIGRAVITY_DEFAULT_PROJECT_ID: 'default-project'
}))

mock.module('../../src/upstream', () => ({
  buildUpstreamHeaders: () => ({ 'x-upstream': 'true' }),
  getDefaultEndpoint: () => 'https://default.test/v1/chat/completions',
  parseRetryAfterMs: () => 0
}))

mock.module('../../src/handlers/request-sanitizer', () => ({
  sanitizeRequestSignatures: () => ({ messages: undefined, strategy: 'none' })
}))

describe('Upstream Request Builder', () => {
  const mockSignatureStore = new SignatureStore()

  it('builds a basic request for generic provider', async () => {
    const input: RequestBuilderInput = {
      reqId: 'test-req',
      body: { model: 'gpt-4o', messages: [] },
      options: {
        sourceFormat: 'openai',
        targetProvider: 'openai',
        targetModel: 'gpt-4o'
      },
      retryState: createRetryState(),
      mode: 'non-streaming',
      signatureStore: mockSignatureStore
    }

    const result = await buildUpstreamRequest(input)

    expect(result.request.endpoint).toContain('default.test')
    expect(result.request.meta.provider).toBe('openai')
    expect(result.request.meta.model).toBe('gpt-4o')
    expect(result.request.init.method).toBe('POST')
    expect(JSON.parse(result.request.init.body)).toHaveProperty('model', 'gpt-4o')
  })
})
