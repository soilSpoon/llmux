import { describe, it, expect } from 'bun:test'
import type { Provider } from '../../src/providers/base'
import type { 
  UpstreamPreparationStrategy, 
  ThinkingStrategyResolver, 
  MetadataInjectionStrategy,
  RateLimitStrategy 
} from '../../src/types/provider-strategies'

describe('Provider Strategy Interface', () => {
  // Mock Provider Implementation
  class MockProvider implements Provider {
    name = 'openai' as const
    config = {
      name: 'openai' as const,
      supportsStreaming: true,
      supportsThinking: false,
      supportsTools: true
    }

    strategies: Map<string, any> = new Map()

    isSupportedRequest() { return true }
    parse(_req: any) { return {} as any }
    transform(_req: any) { return {} }
    parseResponse(_res: any) { return {} as any }
    transformResponse(_res: any) { return {} }
    parseError(_err: any) { return {} as any }

    // Strategy implementation
    getStrategy<T>(type: string): T | null {
      return this.strategies.get(type) || null
    }

    // Helper for testing
    addStrategy(type: string, strategy: any) {
      this.strategies.set(type, strategy)
    }
  }

  it('should support UpstreamPreparationStrategy retrieval', () => {
    const provider = new MockProvider()
    const upstreamStrategy: UpstreamPreparationStrategy = {
      strategyType: 'upstream',
      prepare: async () => ({
        accountIndex: 1,
        endpoint: 'https://api.example.com',
        headers: { 'Authorization': 'Bearer token' }
      })
    }

    provider.addStrategy('upstream', upstreamStrategy)

    const retrieved = provider.getStrategy<UpstreamPreparationStrategy>('upstream')
    expect(retrieved).toBeDefined()
    expect(retrieved?.strategyType).toBe('upstream')
    expect(retrieved?.prepare).toBeDefined()
  })

  it('should support ThinkingStrategyResolver retrieval', () => {
    const provider = new MockProvider()
    const thinkingStrategy: ThinkingStrategyResolver = {
      strategyType: 'thinking',
      getMode: (model) => model.includes('claude') ? 'claude-fresh' : 'standard',
      shouldStripSignatures: () => true
    }

    provider.addStrategy('thinking', thinkingStrategy)

    const retrieved = provider.getStrategy<ThinkingStrategyResolver>('thinking')
    expect(retrieved).toBeDefined()
    expect(retrieved?.getMode('claude-3-5')).toBe('claude-fresh')
  })

  it('should support MetadataInjectionStrategy retrieval', () => {
    const provider = new MockProvider()
    const metadataStrategy: MetadataInjectionStrategy = {
      strategyType: 'metadata',
      requiresInjection: () => true,
      getMetadata: () => ({ project: 'test-project' })
    }

    provider.addStrategy('metadata', metadataStrategy)

    const retrieved = provider.getStrategy<MetadataInjectionStrategy>('metadata')
    expect(retrieved).toBeDefined()
    expect(retrieved?.getMetadata({ model: 'gpt-4' })).toEqual({ project: 'test-project' })
  })

  it('should return null for unimplemented strategies', () => {
    const provider = new MockProvider()
    const retrieved = provider.getStrategy<RateLimitStrategy>('rateLimit')
    expect(retrieved).toBeNull()
  })
})
