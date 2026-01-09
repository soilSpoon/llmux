import { describe, expect, it, mock } from 'bun:test'
import { ModelRouter } from '../model-router'
import type { ModelLookup } from '../../models/lookup'

describe('ModelRouter fallback with modelLookup', () => {
  it('should resolve fallback model provider using modelLookup when not in static mappings', async () => {
    // Mock modelLookup that returns opencode-zen for glm-4.7-free
    const mockModelLookup: ModelLookup = {
      getProviderForModel: mock(async (modelId: string) => {
        if (modelId === 'glm-4.7-free') {
          return 'opencode-zen'
        }
        return undefined
      }),
      hasModel: mock(async () => true),
      refresh: mock(async () => {}),
    }

    const router = new ModelRouter({
      modelMappings: {
        'claude-opus-4-5-20251101': {
          provider: 'antigravity',
          model: 'claude-opus-4-5-thinking',
          fallbacks: ['glm-4.7-free', 'big-pickle'], // These are NOT in modelMappings
        },
      },
      modelLookup: mockModelLookup,
    })

    const result = await router.resolve('claude-opus-4-5-20251101')

    // Primary resolution should work
    expect(result.providerId).toBe('antigravity')
    expect(result.targetModel).toBe('claude-opus-4-5-thinking')

    // Fallbacks should be resolved via modelLookup
    expect(result.fallbacks.length).toBeGreaterThanOrEqual(1)
    
    // glm-4.7-free should be resolved to opencode-zen via modelLookup
    const glmFallback = result.fallbacks.find((fb) => fb.model === 'glm-4.7-free')
    expect(glmFallback).toBeDefined()
    expect(glmFallback?.provider).toBe('opencode-zen')
  })

  it('should skip fallback model when not found in both mappings and modelLookup', async () => {
    const mockModelLookup: ModelLookup = {
      getProviderForModel: mock(async () => undefined),
      hasModel: mock(async () => false),
      refresh: mock(async () => {}),
    }

    const router = new ModelRouter({
      modelMappings: {
        'claude-opus-4-5-20251101': {
          provider: 'antigravity',
          model: 'claude-opus-4-5-thinking',
          fallbacks: ['unknown-model'],
        },
      },
      modelLookup: mockModelLookup,
    })

    const result = await router.resolve('claude-opus-4-5-20251101')

    // Primary resolution should work
    expect(result.providerId).toBe('antigravity')
    
    // Unknown fallback should be skipped
    expect(result.fallbacks.length).toBe(0)
  })
})
