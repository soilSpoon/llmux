import { describe, expect, it } from 'bun:test'
import { ModelRouter } from '../model-router'
import type { ModelLookup } from '../types'

describe('ModelRouter', () => {
  it('should resolve explicit provider suffix', async () => {
    const router = new ModelRouter()
    const result = await router.resolve('gpt-4:openai')
    
    expect(result.providerId).toBe('openai')
    expect(result.targetModel).toBe('gpt-4')
    expect(result.source).toBe('explicit')
  })

  it('should resolve using static mapping', async () => {
    const router = new ModelRouter({
      modelMappings: {
        'claude-3-opus': { provider: 'anthropic', model: 'claude-3-opus-20240229' }
      }
    })
    const result = await router.resolve('claude-3-opus')
    
    expect(result.providerId).toBe('anthropic')
    expect(result.targetModel).toBe('claude-3-opus-20240229')
    expect(result.source).toBe('mapping')
  })

  it('should resolve using model lookup', async () => {
    const mockLookup: ModelLookup = {
      getProviderForModel: async (model) => model === 'gemini-pro' ? 'gemini' : undefined,
      refresh: async () => {}
    }
    
    const router = new ModelRouter({ modelLookup: mockLookup })
    const result = await router.resolve('gemini-pro')
    
    expect(result.providerId).toBe('gemini')
    expect(result.targetModel).toBe('gemini-pro')
    expect(result.source).toBe('lookup')
  })

  it('should fallback to inference if lookup fails', async () => {
    const mockLookup: ModelLookup = {
      getProviderForModel: async () => undefined,
      refresh: async () => {}
    }
    
    const router = new ModelRouter({ modelLookup: mockLookup })
    const result = await router.resolve('claude-3-sonnet')
    
    expect(result.providerId).toBe('anthropic')
    expect(result.targetModel).toBe('claude-3-sonnet')
    expect(result.source).toBe('inference')
  })

  it('should default to openai for unknown patterns', async () => {
    const router = new ModelRouter()
    const result = await router.resolve('unknown-model')
    
    expect(result.providerId).toBe('openai')
    expect(result.targetModel).toBe('unknown-model')
    expect(result.source).toBe('inference')
  })
})
