import { describe, expect, it } from 'bun:test'
import type { Provider, ProviderConfig, ProviderName } from '../../src/providers/base'
import { BaseProvider } from '../../src/providers/base'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../src/types/unified'

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

  it('should accept optional defaultMaxTokens', () => {
    const config: ProviderConfig = {
      name: 'anthropic',
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      defaultMaxTokens: 8192,
    }
    expect(config.defaultMaxTokens).toBe(8192)
  })
})

describe('Provider interface', () => {
  it('should define all required methods', () => {
    const mockProvider: Provider = {
      name: 'openai',
      config: {
        name: 'openai',
        supportsStreaming: true,
        supportsThinking: false,
        supportsTools: true,
      },
      parse: (_request: unknown) => ({
        messages: [],
      }),
      transform: (_request: UnifiedRequest) => ({}),
      parseResponse: (_response: unknown) => ({
        id: 'test',
        content: [],
        stopReason: 'end_turn',
      }),
      transformResponse: (_response: UnifiedResponse) => ({}),
    }

    expect(mockProvider.name).toBe('openai')
    expect(typeof mockProvider.parse).toBe('function')
    expect(typeof mockProvider.transform).toBe('function')
    expect(typeof mockProvider.parseResponse).toBe('function')
    expect(typeof mockProvider.transformResponse).toBe('function')
  })

  it('should allow optional streaming methods', () => {
    const mockProvider: Provider = {
      name: 'anthropic',
      config: {
        name: 'anthropic',
        supportsStreaming: true,
        supportsThinking: true,
        supportsTools: true,
      },
      parse: () => ({ messages: [] }),
      transform: () => ({}),
      parseResponse: () => ({ id: 'test', content: [], stopReason: 'end_turn' }),
      transformResponse: () => ({}),
      parseStreamChunk: (_chunk: string) => ({ type: 'content', delta: { type: 'text', text: 'Hi' } }),
      transformStreamChunk: (_chunk: StreamChunk) => 'data: {"text": "Hi"}\n\n',
    }

    expect(mockProvider.parseStreamChunk).toBeDefined()
    expect(mockProvider.transformStreamChunk).toBeDefined()
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

      parse(_request: unknown): UnifiedRequest {
        return { messages: [] }
      }

      transform(_request: UnifiedRequest): unknown {
        return {}
      }

      parseResponse(_response: unknown): UnifiedResponse {
        return { id: 'test', content: [], stopReason: 'end_turn' }
      }

      transformResponse(_response: UnifiedResponse): unknown {
        return {}
      }
    }

    const provider = new TestProvider()
    expect(provider.name).toBe('openai')
    expect(provider.config.supportsStreaming).toBe(true)
  })

  it('should allow optional stream methods in subclass', () => {
    class StreamingProvider extends BaseProvider {
      readonly name = 'gemini' as const
      readonly config: ProviderConfig = {
        name: 'gemini',
        supportsStreaming: true,
        supportsThinking: true,
        supportsTools: true,
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

      parseStreamChunk(chunk: string): StreamChunk | null {
        if (!chunk) return null
        return { type: 'content', delta: { type: 'text', text: chunk } }
      }

      transformStreamChunk(chunk: StreamChunk): string {
        return `data: ${JSON.stringify(chunk)}\n\n`
      }
    }

    const provider = new StreamingProvider()
    const parsed = provider.parseStreamChunk('Hello')
    expect(parsed?.delta?.text).toBe('Hello')

    const transformed = provider.transformStreamChunk({ type: 'done', stopReason: 'end_turn' })
    expect(transformed).toContain('data:')
  })
})
