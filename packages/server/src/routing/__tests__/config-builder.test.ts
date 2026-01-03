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
    const mappings = [{ from: 'my-model', to: 'gpt-4:openai' }]

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
        to: ['gpt-4:openai', 'glm-4.7-free'],
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
        to: ['gpt-4:openai', 'unknown-fallback'],
      },
    ]
    const mockLookup = createMockModelLookup({})

    await expect(buildRoutingConfig(mappings, mockLookup)).rejects.toThrow(
      'Provider must be specified for fallback mapping: unknown-fallback'
    )
  })

  it('prefers explicit provider over modelLookup', async () => {
    const mappings = [{ from: 'my-model', to: 'gpt-4:anthropic' }]
    const mockLookup = createMockModelLookup({
      'gpt-4': 'openai',
    })

    const result = await buildRoutingConfig(mappings, mockLookup)

    expect(result.modelMapping?.['my-model']?.provider).toBe('anthropic')
  })
})
