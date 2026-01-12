import { describe, expect, it } from 'bun:test'
import { ModelRouter } from '../model-router'
import type { ModelLookup, UpstreamProvider } from '../types'

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

  it('should throw error when model not found', async () => {
    const mockLookup: ModelLookup = {
      getProviderForModel: async () => undefined,
      refresh: async () => {}
    }
    
    const router = new ModelRouter({ modelLookup: mockLookup })
    
    await expect(router.resolve('unknown-model')).rejects.toThrow(
      'No provider found for model'
    )
  })

  it('should use lookup result even when mapping not found', async () => {
    const mockLookup: ModelLookup = {
      getProviderForModel: async (model) => model === 'claude-3-sonnet' ? 'anthropic' : undefined,
      refresh: async () => {}
    }
    
    const router = new ModelRouter({ modelLookup: mockLookup })
    const result = await router.resolve('claude-3-sonnet')
    
    expect(result.providerId).toBe('anthropic')
    expect(result.targetModel).toBe('claude-3-sonnet')
    expect(result.source).toBe('lookup')
  })

  it('should resolve nested fallbacks and explicit provider in fallbacks', async () => {
    // reproduction scenario
    const router = new ModelRouter({
      modelMappings: {
        'complex-chain': { 
          provider: 'openai' as UpstreamProvider, 
          model: 'model-a', 
          fallbacks: ['intermediate-model'] 
        },
        'intermediate-model': {
          provider: 'anthropic' as UpstreamProvider, 
          model: 'model-b', 
          fallbacks: [
            'openai/model-c', // explicit format (must use valid provider name)
            'final-model', // another mapped model
            'direct-model' // lookup simulation
          ]
        },
        'final-model': {
          provider: 'gemini' as UpstreamProvider, 
          model: 'model-d'
        }
      },
      modelLookup: {
        getProviderForModel: async (model) => model === 'direct-model' ? 'provider-e' : undefined,
        refresh: async () => {}
      }
    })

    const result = await router.resolve('complex-chain')
 
     expect(result.providerId).toBe('openai')
     expect(result.targetModel).toBe('model-a')
     
     // Check fallback order and resolution
     // 1. intermediate-model -> provider-b/model-b
     // 2. openai/model-c -> openai/model-c (explicit string in fallback list)
     // 3. final-model -> provider-d/model-d
     // 4. direct-model -> provider-e/direct-model
     
     expect(result.fallbacks).toHaveLength(4)
     expect(result.fallbacks[0]).toEqual({ provider: 'anthropic' as UpstreamProvider, model: 'model-b' })
     expect(result.fallbacks[1]).toEqual({ provider: 'openai', model: 'model-c' })
     expect(result.fallbacks[2]).toEqual({ provider: 'gemini' as UpstreamProvider, model: 'model-d' })
     expect(result.fallbacks[3]).toEqual({ provider: 'provider-e' as UpstreamProvider, model: 'direct-model' })
  })

  it('should handle circular fallbacks via visited set', async () => {
    const router = new ModelRouter({
      modelMappings: {
        'ping': { provider: 'openai' as UpstreamProvider, model: 'ping', fallbacks: ['pong'] },
        'pong': { provider: 'openai' as UpstreamProvider, model: 'pong', fallbacks: ['ping'] }
      }
    })
    
    const result = await router.resolve('ping')
    // Fallbacks should contain pong, but stop there (no double ping)
    expect(result.fallbacks).toHaveLength(1)
    expect(result.fallbacks[0]!.model).toBe('pong')
  })
})
