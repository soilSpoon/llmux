import { describe, expect, it } from 'bun:test'
import type { Provider, ProviderConfig, ProviderName } from '../../src/providers/base'
import { BaseProvider } from '../../src/providers/base'
import type { UnifiedRequest, UnifiedResponse } from '../../src/types/unified'

describe('ProviderName', () => {
  it('should support all provider names', () => {
    const names: ProviderName[] = ['openai', 'anthropic', 'gemini', 'antigravity']
    expect(names).toHaveLength(4)
  })
})

describe('ProviderConfig', () => {
  it('should have required fields', () => {
    const config: ProviderConfig = {
      name: 'openai',
      supportsStreaming: true,
      supportsThinking: false,
      supportsTools: true,
    }
    expect(config.name).toBe('openai')
    expect(config.supportsStreaming).toBe(true)
  })


  it('should allow optional authType field', () => {
    const configWithAuth: ProviderConfig = {
      name: 'anthropic',
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      authType: 'apiKey',
    }
    expect(configWithAuth.authType).toBe('apiKey')
  })
})

describe('Provider interface', () => {
  it('should require core methods', () => {
    const mockProvider: Provider = {
      name: 'openai',
      config: {
        name: 'openai',
        supportsStreaming: true,
        supportsThinking: false,
        supportsTools: true,
      },
      isSupportedRequest: () => true,
      parse: () => ({ messages: [] }),
      transform: () => ({}),
      parseResponse: () => ({ id: 'test', content: [], stopReason: 'end_turn' }),
      transformResponse: () => ({}),
      parseError: (error: unknown) => ({
        provider: 'openai',
        code: 'unknown_error',
        message: String(error),
        retryable: false
      })
    }

    expect(mockProvider.name).toBe('openai')
    expect(typeof mockProvider.parse).toBe('function')
    expect(typeof mockProvider.transform).toBe('function')
    expect(typeof mockProvider.parseResponse).toBe('function')
    expect(typeof mockProvider.transformResponse).toBe('function')
  })

  it('should not have streaming methods (removed in Hub-and-Spoke refactor)', () => {
    const mockProvider: Provider = {
      name: 'anthropic',
      config: {
        name: 'anthropic',
        supportsStreaming: true,
        supportsThinking: true,
        supportsTools: true,
      },
      isSupportedRequest: () => true,
      parse: () => ({ messages: [] }),
      transform: () => ({}),
      parseResponse: () => ({ id: 'test', content: [], stopReason: 'end_turn' }),
      transformResponse: () => ({}),
      parseError: (error: unknown) => ({
        provider: 'anthropic',
        code: 'unknown_error',
        message: String(error),
        retryable: false
      })
    }

    // Streaming methods are now on Formats, not Providers
    expect('parseStreamChunk' in mockProvider).toBe(false)
    expect('transformStreamChunk' in mockProvider).toBe(false)
  })
})

describe('BaseProvider', () => {
  it('should be extendable', () => {
    class TestProvider extends BaseProvider {
      readonly name = 'openai' as const
      readonly config: ProviderConfig = {
        name: 'openai',
        supportsStreaming: true,
        supportsThinking: false,
        supportsTools: true,
      }

      isSupportedRequest(_request: unknown): boolean {
        return true
      }

      parse(): UnifiedRequest {
        return { messages: [] }
      }
      transform(): unknown {
        return {}
      }
      parseResponse(): UnifiedResponse {
        return { id: 'test', content: [], stopReason: 'end_turn' }
      }
      transformResponse(): unknown {
        return {}
      }
    }

    const provider = new TestProvider()
    expect(provider.name).toBe('openai')
  })

  it('should have default parseError implementation', () => {
    class TestProvider extends BaseProvider {
      readonly name = 'anthropic' as const
      readonly config: ProviderConfig = {
        name: 'anthropic',
        supportsStreaming: true,
        supportsThinking: true,
        supportsTools: true,
      }

      isSupportedRequest(_request: unknown): boolean {
        return true
      }

      parse(): UnifiedRequest {
        return { messages: [] }
      }
      transform(): unknown {
        return {}
      }
      parseResponse(): UnifiedResponse {
        return { id: 'test', content: [], stopReason: 'end_turn' }
      }
      transformResponse(): unknown {
        return {}
      }
    }

    const provider = new TestProvider()
    const error = provider.parseError(new Error('test error'))
    expect(error.code).toBe('unknown_error')
    expect(error.message).toBe('test error')
  })
})
