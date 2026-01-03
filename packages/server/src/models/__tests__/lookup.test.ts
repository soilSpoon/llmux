import { describe, expect, it } from 'bun:test'
import { findProviderByPrefix } from '../lookup'
import type { ModelProvider } from '../types'

describe('findProviderByPrefix', () => {
  describe('exact match', () => {
    it('returns exact match first', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-sonnet', 'anthropic'],
      ])

      const provider = findProviderByPrefix('claude-sonnet-4-5', cache)
      expect(provider).toBe('antigravity')
    })
  })

  describe('prefix matching', () => {
    it('matches when request model starts with cached model', () => {
      const cache = new Map<string, ModelProvider>([['claude-sonnet-4-5', 'antigravity']])

      const provider = findProviderByPrefix('claude-sonnet-4-5-20250929', cache)
      expect(provider).toBe('antigravity')
    })

    it('matches when cached model starts with request model', () => {
      const cache = new Map<string, ModelProvider>([['gemini-2.5-pro-preview', 'antigravity']])

      const provider = findProviderByPrefix('gemini-2.5-pro', cache)
      expect(provider).toBe('antigravity')
    })

    it('returns longest match when multiple matches from same provider', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet', 'antigravity'],
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-sonnet-4-5-thinking', 'antigravity'],
      ])

      const provider = findProviderByPrefix('claude-sonnet-4-5-thinking-high', cache)
      expect(provider).toBe('antigravity')
    })
  })

  describe('ambiguous matching', () => {
    it('returns undefined when multiple providers match', () => {
      const cache = new Map<string, ModelProvider>([
        ['gpt-4', 'openai'],
        ['gpt-4-turbo', 'openai-web'],
      ])

      const provider = findProviderByPrefix('gpt-4-turbo-preview', cache)
      expect(provider).toBeUndefined()
    })

    it('returns undefined when same prefix matches different providers', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-3', 'anthropic'],
        ['claude-3-opus', 'antigravity'],
      ])

      const provider = findProviderByPrefix('claude-3-opus-20240229', cache)
      expect(provider).toBeUndefined()
    })
  })

  describe('no match', () => {
    it('returns undefined when no match found', () => {
      const cache = new Map<string, ModelProvider>([['claude-sonnet-4-5', 'antigravity']])

      const provider = findProviderByPrefix('completely-different-model', cache)
      expect(provider).toBeUndefined()
    })

    it('returns undefined for empty cache', () => {
      const cache = new Map<string, ModelProvider>()

      const provider = findProviderByPrefix('any-model', cache)
      expect(provider).toBeUndefined()
    })
  })

  describe('real-world scenarios', () => {
    it('Factory Droid: claude-sonnet-4-5-20250929 matches antigravity claude-sonnet-4-5', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-opus-4-5-thinking-low', 'antigravity'],
        ['gemini-2.5-pro', 'antigravity'],
      ])

      expect(findProviderByPrefix('claude-sonnet-4-5-20250929', cache)).toBe('antigravity')
    })

    it('Factory Droid: gemini-2.5-pro matches antigravity', () => {
      const cache = new Map<string, ModelProvider>([
        ['gemini-2.5-pro', 'antigravity'],
        ['gemini-2.5-flash', 'antigravity'],
      ])

      expect(findProviderByPrefix('gemini-2.5-pro', cache)).toBe('antigravity')
    })

    it('gpt-5 with single provider matches', () => {
      const cache = new Map<string, ModelProvider>([['gpt-5', 'openai-web']])

      expect(findProviderByPrefix('gpt-5', cache)).toBe('openai-web')
      expect(findProviderByPrefix('gpt-5-turbo', cache)).toBe('openai-web')
    })
  })
})
