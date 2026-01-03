import { describe, expect, it, mock } from 'bun:test'
import { ModelRouter } from '../../src/routing/model-router'
import type { ModelLookup } from '../../src/models/lookup'

describe('ModelRouter', () => {
  // Mock ModelLookup
  const mockModelLookup: ModelLookup = {
    getProviderForModel: mock(async (model: string) => {
      if (model === 'known-model') return 'anthropic'
      if (model === 'gpt-4') return 'openai'
      if (model === 'claude-3-opus') return 'anthropic'
      return undefined
    }),
    hasModel: mock(async () => false),
    refresh: mock(async () => {}),
  }

  it('resolves explicit provider suffix', async () => {
    const router = new ModelRouter()
    const result = await router.resolve('my-model:antigravity')
    
    expect(result).toEqual({
      providerId: 'antigravity',
      targetModel: 'my-model',
      fallbacks: [],
      source: 'explicit',
    })
  })

  it('resolves using static mapping', async () => {
    const router = new ModelRouter({
      modelMappings: {
        'mapped-model': {
          provider: 'gemini',
          model: 'gemini-mapped',
          fallbacks: ['fallback-model'],
        },
        'fallback-model': {
          provider: 'anthropic',
          model: 'fallback-model',
        },
      },
    })
    
    const result = await router.resolve('mapped-model')
    
    expect(result).toEqual({
      providerId: 'gemini',
      targetModel: 'gemini-mapped',
      fallbacks: [{ provider: 'anthropic', model: 'fallback-model' }],
      source: 'mapping',
    })
  })

  it('resolves using ModelLookup', async () => {
    const router = new ModelRouter({
      modelLookup: mockModelLookup,
    })
    
    const result = await router.resolve('known-model')
    
    expect(result).toEqual({
      providerId: 'anthropic',
      targetModel: 'known-model',
      fallbacks: [],
      source: 'lookup',
    })
    
    expect(mockModelLookup.getProviderForModel).toHaveBeenCalledWith('known-model')
  })

  it('throws error when model not found and no fallback', async () => {
    const router = new ModelRouter({})
    
    await expect(router.resolve('unknown-model')).rejects.toThrow(
      'No provider found for model: unknown-model'
    )
  })

  it('uses ModelLookup when mapping not found', async () => {
    const router = new ModelRouter({
      modelLookup: mockModelLookup,
    })
    
    const result = await router.resolve('claude-3-opus')
    
    expect(result).toEqual({
      providerId: 'anthropic',
      targetModel: 'claude-3-opus',
      fallbacks: [],
      source: 'lookup',
    })
  })

  describe('resolveSync', () => {
    it('resolves synchronously using explicit provider', () => {
      const router = new ModelRouter({})

      expect(router.resolveSync('gpt-4:openai')).toEqual({
        providerId: 'openai',
        targetModel: 'gpt-4',
        fallbacks: [],
        source: 'explicit',
      })
    })

    it('resolves synchronously using mapping', () => {
      const router = new ModelRouter({
        modelMappings: {
          'sync-mapped': { provider: 'gemini', model: 'gemini-sync' }
        }
      })

      expect(router.resolveSync('sync-mapped')).toEqual({
        providerId: 'gemini',
        targetModel: 'gemini-sync',
        fallbacks: [],
        source: 'mapping',
      })
    })

    it('throws error when model not found in sync mode', () => {
      const router = new ModelRouter({})

      expect(() => router.resolveSync('unknown-model')).toThrow(
        'No provider found for model: unknown-model'
      )
    })
  })
})
