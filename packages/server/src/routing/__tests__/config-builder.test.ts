import { describe, expect, it } from 'bun:test'
import type { ModelLookup } from '../../models/lookup'
import type { ModelProvider } from '../../models/types'
import { buildRoutingConfig } from '../config-builder'

function createMockModelLookup(
  modelProviderMap: Record<string, ModelProvider>
): ModelLookup {
  return {
    async getProviderForModel(modelId: string) {
      return modelProviderMap[modelId]
    },
    async hasModel(modelId: string) {
      return modelId in modelProviderMap
    },
    async refresh() {},
  }
}

describe('buildRoutingConfig', () => {
  it('returns empty config when no mappings provided', async () => {
    const result = await buildRoutingConfig(undefined)
    expect(result).toEqual({})
  })

  it('parses explicit provider from mapping', async () => {
    const mappings = [{ from: 'my-model', to: 'openai/gpt-4' }]

    const result = await buildRoutingConfig(mappings)

    expect(result.modelMapping?.['my-model']).toEqual({
      provider: 'openai',
      model: 'gpt-4',
      fallbacks: [],
    })
  })

  it('resolves provider from modelLookup when not specified', async () => {
    const mappings = [{ from: 'my-model', to: 'glm-4.7-free' }]
    const mockLookup = createMockModelLookup({
      'glm-4.7-free': 'opencode-zen',
    })

    const result = await buildRoutingConfig(mappings, mockLookup)

    expect(result.modelMapping?.['my-model']).toEqual({
      provider: 'opencode-zen',
      model: 'glm-4.7-free',
      fallbacks: [],
    })
  })

  it('throws error when provider cannot be resolved', async () => {
    const mappings = [{ from: 'my-model', to: 'unknown-model' }]

    await expect(buildRoutingConfig(mappings)).rejects.toThrow(
      'Provider must be specified for model mapping: unknown-model'
    )
  })

  it('throws error when modelLookup returns undefined', async () => {
    const mappings = [{ from: 'my-model', to: 'unknown-model' }]
    const mockLookup = createMockModelLookup({})

    await expect(buildRoutingConfig(mappings, mockLookup)).rejects.toThrow(
      'Provider must be specified for model mapping: unknown-model'
    )
  })

  it('resolves fallback provider from modelLookup', async () => {
    const mappings = [
      {
        from: 'my-model',
        to: ['openai/gpt-4', 'glm-4.7-free'],
      },
    ]
    const mockLookup = createMockModelLookup({
      'glm-4.7-free': 'opencode-zen',
    })

    const result = await buildRoutingConfig(mappings, mockLookup)

    expect(result.modelMapping?.['my-model']).toEqual({
      provider: 'openai',
      model: 'gpt-4',
      fallbacks: ['glm-4.7-free'],
    })
    expect(result.modelMapping?.['glm-4.7-free']).toEqual({
      provider: 'opencode-zen',
      model: 'glm-4.7-free',
    })
  })

  it('throws error when fallback provider cannot be resolved', async () => {
    const mappings = [
      {
        from: 'my-model',
        to: ['openai/gpt-4', 'unknown-fallback'],
      },
    ]
    const mockLookup = createMockModelLookup({})

    await expect(buildRoutingConfig(mappings, mockLookup)).rejects.toThrow(
      'Provider must be specified for fallback mapping: unknown-fallback'
    )
  })

  it('prefers explicit provider over modelLookup', async () => {
    const mappings = [{ from: 'my-model', to: 'anthropic/gpt-4' }]
    const mockLookup = createMockModelLookup({
      'gpt-4': 'openai',
    })

    const result = await buildRoutingConfig(mappings, mockLookup)

    expect(result.modelMapping?.['my-model']?.provider).toBe('anthropic')
  })

  it('infers provider from slash format when lookup fails', async () => {
    const mappings = [{ from: 'my-model', to: 'unknown-provider/some-model' }]
    // Mock lookup returns nothing
    const mockLookup = createMockModelLookup({})

    const result = await buildRoutingConfig(mappings, mockLookup)

    expect(result.modelMapping?.['my-model']).toEqual({
      provider: 'unknown-provider' as any,
      model: 'some-model',
      fallbacks: [],
    })
  })

  it('resolves fallback provider from other mappings in config', async () => {
    const mappings = [
      { from: 'alias1', to: ['provider1/model1', 'alias2'] },
      { from: 'alias2', to: 'provider2/model2' },
    ]

    const result = await buildRoutingConfig(mappings)

    expect(result.modelMapping?.['alias1']).toEqual({
      provider: 'provider1' as any,
      model: 'model1',
      fallbacks: ['alias2'],
    })

    expect(result.modelMapping?.['alias2']).toEqual({
      provider: 'provider2' as any,
      model: 'model2',
      fallbacks: [],
    })
  })

  it('resolves deeply nested aliased providers', async () => {
    const mappings = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'provider/model' },
    ]

    const result = await buildRoutingConfig(mappings)

    expect(result.modelMapping?.['a']).toEqual({
      provider: 'provider' as any,
      model: 'model',
      fallbacks: [],
    })
    expect(result.modelMapping?.['b']).toEqual({
      provider: 'provider' as any,
      model: 'model',
      fallbacks: [],
    })
  })

  it('handles circular aliases gracefully by failing if provider not found', async () => {
    const mappings = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]

    await expect(buildRoutingConfig(mappings)).rejects.toThrow(
      'Provider must be specified for model mapping: b'
    )
  })

  it('should preserve fallbacks on primary target model for depth-first traversal', async () => {
    // Given: A -> [B, C, D] where B is "provider/model-b"
    // When buildRoutingConfig processes this
    // Then: "model-b" should also have fallbacks [C, D] so ModelRouter can traverse depth-first
    const mappings = [
      {
        from: 'alias-a',
        to: ['openai/model-b', 'anthropic/model-c', 'gemini/model-d'],
      },
    ]

    const result = await buildRoutingConfig(mappings)

    expect(result.modelMapping?.['alias-a']).toEqual({
      provider: 'openai',
      model: 'model-b',
      fallbacks: ['anthropic/model-c', 'gemini/model-d'],
    })

    expect(result.modelMapping?.['model-b']).toEqual({
      provider: 'openai',
      model: 'model-b',
      fallbacks: ['anthropic/model-c', 'gemini/model-d'],
    })
  })

  it('should support nested fallback chains through buildRoutingConfig', async () => {
    // Given: A -> [B, C] and B -> [D, E]
    // When: Request comes for A and B fails
    // Then: ModelRouter should find B's fallbacks [D, E] because buildRoutingConfig set them
    const mappings = [
      { from: 'model-a', to: ['openai/model-b', 'model-c'] },
      { from: 'model-b', to: ['openai/model-b-impl', 'anthropic/model-d', 'gemini/model-e'] },
      { from: 'model-c', to: 'anthropic/model-c-impl' },
    ]

    const result = await buildRoutingConfig(mappings)

    expect(result.modelMapping?.['model-a']?.fallbacks).toEqual(['model-c'])

    expect(result.modelMapping?.['model-b']).toEqual({
      provider: 'openai',
      model: 'model-b-impl',
      fallbacks: ['anthropic/model-d', 'gemini/model-e'],
    })
  })
})
