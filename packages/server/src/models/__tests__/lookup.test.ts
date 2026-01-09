import { describe, expect, it } from 'bun:test'
import { findProviderExact } from '../lookup'
import type { ModelProvider } from '../types'

describe('findProviderExact', () => {
  describe('exact match', () => {
    it('returns exact match', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-sonnet', 'anthropic'],
      ])

      const provider = findProviderExact('claude-sonnet-4-5', cache)
      expect(provider).toBe('antigravity')
    })
  })

  describe('prefix matching (DISABLED)', () => {
    it('should returns undefined when request model starts with cached model', () => {
      const cache = new Map<string, ModelProvider>([['claude-sonnet-4-5', 'antigravity']])

      const provider = findProviderExact('claude-sonnet-4-5-20250929', cache)
      expect(provider).toBeUndefined()
    })

    it('should returns undefined when cached model starts with request model', () => {
      const cache = new Map<string, ModelProvider>([['gemini-2.5-pro-preview', 'antigravity']])

      const provider = findProviderExact('gemini-2.5-pro', cache)
      expect(provider).toBeUndefined()
    })

    it('should returns undefined even when multiple matches from same provider exist', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet', 'antigravity'],
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-sonnet-4-5-thinking', 'antigravity'],
      ])

      const provider = findProviderExact('claude-sonnet-4-5-thinking-high', cache)
      expect(provider).toBeUndefined()
    })
  })

  describe('ambiguous matching (Now just No Match)', () => {
    it('returns undefined when multiple providers match via prefix', () => {
      const cache = new Map<string, ModelProvider>([
        ['gpt-4', 'openai'],
        ['gpt-4-turbo', 'openai-web'],
      ])

      const provider = findProviderExact('gpt-4-turbo-preview', cache)
      expect(provider).toBeUndefined()
    })
  })

  describe('no match', () => {
    it('returns undefined when no match found', () => {
      const cache = new Map<string, ModelProvider>([['claude-sonnet-4-5', 'antigravity']])

      const provider = findProviderExact('completely-different-model', cache)
      expect(provider).toBeUndefined()
    })

    it('returns undefined for empty cache', () => {
      const cache = new Map<string, ModelProvider>()

      const provider = findProviderExact('any-model', cache)
      expect(provider).toBeUndefined()
    })
  })

  describe('real-world scenarios (Strict Mode)', () => {
    it('Factory Droid: claude-sonnet-4-5-20250929 does NOT match antigravity claude-sonnet-4-5', () => {
      const cache = new Map<string, ModelProvider>([
        ['claude-sonnet-4-5', 'antigravity'],
        ['claude-opus-4-5-thinking-low', 'antigravity'],
        ['gemini-2.5-pro', 'antigravity'],
      ])

      expect(findProviderExact('claude-sonnet-4-5-20250929', cache)).toBeUndefined()
    })

    it('Factory Droid: gemini-2.5-pro does NOT match antigravity gemini-2.5-pro-preview', () => {
      const cache = new Map<string, ModelProvider>([
        ['gemini-2.5-pro-preview', 'antigravity'], // Assuming exact match is NOT 'gemini-2.5-pro' in cache
        ['gemini-2.5-flash', 'antigravity'],
      ])

      expect(findProviderExact('gemini-2.5-pro', cache)).toBeUndefined()
    })

    it('gpt-5 match check', () => {
      const cache = new Map<string, ModelProvider>([['gpt-5', 'openai-web']])

      expect(findProviderExact('gpt-5', cache)).toBe('openai-web')
      expect(findProviderExact('gpt-5-turbo', cache)).toBeUndefined()
    })
  })
})
