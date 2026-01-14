import { describe, expect, it } from 'bun:test'
import { ModelRouter } from '../model-router'
import type { UpstreamProvider } from '../types'

describe('ModelRouter depth-first fallback traversal', () => {
  it('should traverse fallbacks in depth-first order: A -> B -> D -> E -> C -> F -> G', async () => {
    // Given: A's fallbacks: [B, C], B's fallbacks: [D, E], C's fallbacks: [F, G]
    // Expected: A -> B -> D -> E -> C -> F -> G (depth-first)
    const router = new ModelRouter({
      modelMappings: {
        A: {
          provider: 'openai' as UpstreamProvider,
          model: 'model-a',
          fallbacks: ['B', 'C'],
        },
        B: {
          provider: 'anthropic' as UpstreamProvider,
          model: 'model-b',
          fallbacks: ['D', 'E'],
        },
        C: {
          provider: 'gemini' as UpstreamProvider,
          model: 'model-c',
          fallbacks: ['F', 'G'],
        },
        D: {
          provider: 'antigravity' as UpstreamProvider,
          model: 'model-d',
        },
        E: {
          provider: 'opencode-zen' as UpstreamProvider,
          model: 'model-e',
        },
        F: {
          provider: 'openai-web' as UpstreamProvider,
          model: 'model-f',
        },
        G: {
          provider: 'gemini-cli' as UpstreamProvider,
          model: 'model-g',
        },
      },
    })

    const result = await router.resolve('A')

    expect(result.providerId).toBe('openai')
    expect(result.targetModel).toBe('model-a')

    expect(result.fallbacks).toHaveLength(6)
    expect(result.fallbacks[0]).toEqual({ provider: 'anthropic', model: 'model-b' })
    expect(result.fallbacks[1]).toEqual({ provider: 'antigravity', model: 'model-d' })
    expect(result.fallbacks[2]).toEqual({ provider: 'opencode-zen', model: 'model-e' })
    expect(result.fallbacks[3]).toEqual({ provider: 'gemini', model: 'model-c' })
    expect(result.fallbacks[4]).toEqual({ provider: 'openai-web', model: 'model-f' })
    expect(result.fallbacks[5]).toEqual({ provider: 'gemini-cli', model: 'model-g' })
  })

  it('should handle three levels of nesting', async () => {
    // Given: A -> [B, C], B -> [D, E], D -> [H, I], C -> [F, G]
    // Expected: A -> B -> D -> H -> I -> E -> C -> F -> G
    const router = new ModelRouter({
      modelMappings: {
        A: {
          provider: 'openai' as UpstreamProvider,
          model: 'm-a',
          fallbacks: ['B', 'C'],
        },
        B: {
          provider: 'anthropic' as UpstreamProvider,
          model: 'm-b',
          fallbacks: ['D', 'E'],
        },
        C: {
          provider: 'gemini' as UpstreamProvider,
          model: 'm-c',
          fallbacks: ['F', 'G'],
        },
        D: {
          provider: 'antigravity' as UpstreamProvider,
          model: 'm-d',
          fallbacks: ['H', 'I'],
        },
        E: {
          provider: 'opencode-zen' as UpstreamProvider,
          model: 'm-e',
        },
        F: {
          provider: 'openai-web' as UpstreamProvider,
          model: 'm-f',
        },
        G: {
          provider: 'gemini-cli' as UpstreamProvider,
          model: 'm-g',
        },
        H: {
          provider: 'openai' as UpstreamProvider,
          model: 'm-h',
        },
        I: {
          provider: 'anthropic' as UpstreamProvider,
          model: 'm-i',
        },
      },
    })

    const result = await router.resolve('A')

    expect(result.fallbacks).toHaveLength(8)
    expect(result.fallbacks.map((f) => f.model)).toEqual([
      'm-b',
      'm-d',
      'm-h',
      'm-i',
      'm-e',
      'm-c',
      'm-f',
      'm-g',
    ])
  })

  it('should prevent infinite loops with circular references', async () => {
    // Given: A -> B -> C -> A (circular)
    // Expected: A -> B -> C (no duplicate A)
    const router = new ModelRouter({
      modelMappings: {
        A: {
          provider: 'openai' as UpstreamProvider,
          model: 'm-a',
          fallbacks: ['B'],
        },
        B: {
          provider: 'anthropic' as UpstreamProvider,
          model: 'm-b',
          fallbacks: ['C'],
        },
        C: {
          provider: 'gemini' as UpstreamProvider,
          model: 'm-c',
          fallbacks: ['A'],
        },
      },
    })

    const result = await router.resolve('A')

    expect(result.fallbacks).toHaveLength(2)
    expect(result.fallbacks[0]).toEqual({ provider: 'anthropic', model: 'm-b' })
    expect(result.fallbacks[1]).toEqual({ provider: 'gemini', model: 'm-c' })
  })
})
