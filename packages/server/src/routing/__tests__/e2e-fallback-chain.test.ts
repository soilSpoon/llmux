import { describe, expect, it } from 'bun:test'
import type { ModelLookup } from '../../models/lookup'
import type { ModelProvider } from '../../models/types'
import { ModelRouter } from '../model-router'
import { buildRoutingConfig } from '../config-builder'

function createMockModelLookup(modelProviderMap: Record<string, ModelProvider>): ModelLookup {
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

describe('End-to-end fallback chain: buildRoutingConfig -> ModelRouter', () => {
  it('should resolve fallbacks when requesting the mapped model directly', async () => {
    // Given: claude-haiku -> [big-pickle, glm-4.7-free, minimax]
    // When: Request comes for "big-pickle" directly (after mapping)
    // Then: ModelRouter should still know the fallback chain
    const mappings = [
      {
        from: 'claude-haiku-4-5-20251001',
        to: ['opencode-zen/big-pickle', 'opencode-zen/glm-4.7-free', 'opencode-zen/minimax-m2.1-free'],
      },
    ]

    const routingConfig = await buildRoutingConfig(mappings)
    const router = new ModelRouter({ modelMappings: routingConfig.modelMapping })

    const resultFromAlias = await router.resolve('claude-haiku-4-5-20251001')
    expect(resultFromAlias.fallbacks).toHaveLength(2)

    const resultFromMapped = await router.resolve('big-pickle')
    expect(resultFromMapped.providerId).toBe('opencode-zen')
    expect(resultFromMapped.targetModel).toBe('big-pickle')
    expect(resultFromMapped.fallbacks).toHaveLength(2)
    expect(resultFromMapped.fallbacks[0]).toEqual({
      provider: 'opencode-zen',
      model: 'glm-4.7-free',
    })
    expect(resultFromMapped.fallbacks[1]).toEqual({
      provider: 'opencode-zen',
      model: 'minimax-m2.1-free',
    })
  })

  it('should support depth-first traversal through nested mappings', async () => {
    // Given: A -> [B, C] and B -> [D, E] and C -> [F, G]
    // When: Request "A", then fallback to "B", then "B" fails
    // Then: Should try D, E before moving to C
    const mappings = [
      { from: 'model-a', to: ['model-b', 'model-c'] },
      { from: 'model-b', to: ['openai/model-b-primary', 'anthropic/model-d', 'gemini/model-e'] },
      { from: 'model-c', to: ['anthropic/model-c-primary', 'gemini/model-f', 'openai/model-g'] },
    ]

    const routingConfig = await buildRoutingConfig(mappings)
    const router = new ModelRouter({ modelMappings: routingConfig.modelMapping })

    const result = await router.resolve('model-a')

    expect(result.providerId).toBe('openai')
    expect(result.targetModel).toBe('model-b-primary')

    expect(result.fallbacks.map((f) => f.model)).toEqual([
      'model-d',
      'model-e',
      'model-c-primary',
      'model-f',
      'model-g',
    ])
  })

  it('should handle real-world config scenario', async () => {
    // Given: Real config from user's ~/.llmux/config.json
    const mockLookup = createMockModelLookup({
      'big-pickle': 'opencode-zen',
      'glm-4.7-free': 'opencode-zen',
      'minimax-m2.1-free': 'opencode-zen',
    })

    const mappings = [
      {
        from: 'claude-haiku-4-5-20251001',
        to: ['big-pickle', 'glm-4.7-free', 'minimax-m2.1-free', 'antigravity/gemini-3-flash'],
      },
      {
        from: 'gemini-3-pro',
        to: ['gemini-cli/gemini-3-pro-preview', 'antigravity/gemini-3-pro-high'],
      },
    ]

    const routingConfig = await buildRoutingConfig(mappings, mockLookup)
    const router = new ModelRouter({
      modelMappings: routingConfig.modelMapping,
      modelLookup: mockLookup,
    })

    const resultFromAlias = await router.resolve('claude-haiku-4-5-20251001')
    expect(resultFromAlias.providerId).toBe('opencode-zen')
    expect(resultFromAlias.targetModel).toBe('big-pickle')
    expect(resultFromAlias.fallbacks).toHaveLength(3)

    const resultFromMapped = await router.resolve('big-pickle')
    expect(resultFromMapped.providerId).toBe('opencode-zen')
    expect(resultFromMapped.targetModel).toBe('big-pickle')
    expect(resultFromMapped.fallbacks.length).toBeGreaterThan(0)
  })
})
