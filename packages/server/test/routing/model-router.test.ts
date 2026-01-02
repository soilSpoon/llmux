import { describe, expect, it, mock } from 'bun:test'
import { ModelRouter } from '../../src/routing/model-router'
import type { ModelLookup } from '../../src/models/lookup'
import type { CredentialChecker, UpstreamProvider } from '../../src/routing/types'

describe('ModelRouter', () => {
  // Mock ModelLookup
  const mockModelLookup: ModelLookup = {
    getProviderForModel: mock(async (model: string) => {
      if (model === 'known-model') return 'anthropic'
      if (model === 'lookup-openai-model') return 'openai'
      return undefined
    }),
    hasModel: mock(async () => false),
    refresh: mock(async () => {}),
  }

  // Mock CredentialChecker
  const mockCredentialChecker: CredentialChecker = {
    hasCredential: mock(async (provider: UpstreamProvider) => {
      if (provider === 'openai') return true
      if (provider === 'openai-web') return true
      return false
    }),
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
          fallbacks: ['claude-3'],
        },
      },
    })
    
    const result = await router.resolve('mapped-model')
    
    expect(result).toEqual({
      providerId: 'gemini',
      targetModel: 'gemini-mapped',
      fallbacks: [{ provider: 'anthropic', model: 'claude-3' }],
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

  it('falls back to inference when ModelLookup fails', async () => {
    const router = new ModelRouter({
      modelLookup: mockModelLookup,
    })
    
    const result = await router.resolve('claude-3-opus')
    
    expect(result).toEqual({
      providerId: 'anthropic',
      targetModel: 'claude-3-opus',
      fallbacks: [],
      source: 'inference',
    })
  })

  describe('OpenAI Fallback Logic', () => {
    it('uses openai-web primary when both available (inference)', async () => {
      const router = new ModelRouter(
        { enableOpenAIFallback: true },
        mockCredentialChecker
      )
      
      const result = await router.resolve('gpt-4')
      
      expect(result).toEqual({
        providerId: 'openai-web',
        targetModel: 'gpt-4',
        fallbacks: [{ provider: 'openai', model: 'gpt-4' }],
        source: 'inference',
      })
    })

    it('uses openai-web primary when both available (lookup)', async () => {
      const router = new ModelRouter(
        { 
          enableOpenAIFallback: true,
          modelLookup: mockModelLookup
        },
        mockCredentialChecker
      )
      
      const result = await router.resolve('lookup-openai-model')
      
      expect(result).toEqual({
        providerId: 'openai-web',
        targetModel: 'lookup-openai-model',
        fallbacks: [{ provider: 'openai', model: 'lookup-openai-model' }],
        source: 'lookup',
      })
    })

    it('defaults to openai if credential checker not provided', async () => {
      const router = new ModelRouter({ enableOpenAIFallback: true })
      
      const result = await router.resolve('gpt-4')
      
      expect(result).toEqual({
        providerId: 'openai',
        targetModel: 'gpt-4',
        fallbacks: [],
        source: 'inference',
      })
    })
  })

  describe('resolveSync', () => {
    it('resolves synchronously using rules only', () => {
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

      expect(router.resolveSync('gpt-4')).toEqual({
        providerId: 'openai',
        targetModel: 'gpt-4',
        fallbacks: [],
        source: 'inference',
      })
    })
  })
})
