import { describe, expect, it } from 'bun:test'
import {
  isOpenAICompatibleProvider,
  parseExplicitProvider,
} from '../../src/routing/model-rules'

describe('model-rules', () => {
  describe('parseExplicitProvider', () => {
    it('parses valid provider suffix', () => {
      expect(parseExplicitProvider('model:openai')).toEqual({ model: 'model', provider: 'openai' })
      expect(parseExplicitProvider('claude-3-opus:anthropic')).toEqual({
        model: 'claude-3-opus',
        provider: 'anthropic',
      })
      expect(parseExplicitProvider('gemini-pro:antigravity')).toEqual({
        model: 'gemini-pro',
        provider: 'antigravity',
      })
    })

    it('ignores invalid provider suffix', () => {
      expect(parseExplicitProvider('model:unknown')).toEqual({ model: 'model:unknown' })
      expect(parseExplicitProvider('model:blah')).toEqual({ model: 'model:blah' })
    })

    it('handles models without suffix', () => {
      expect(parseExplicitProvider('gpt-4')).toEqual({ model: 'gpt-4' })
    })

    it('handles models with multiple colons correctly', () => {
      expect(parseExplicitProvider('ft:gpt-3.5:org:openai')).toEqual({
        model: 'ft:gpt-3.5:org',
        provider: 'openai',
      })
      expect(parseExplicitProvider('ft:gpt-3.5:org:custom')).toEqual({
        model: 'ft:gpt-3.5:org:custom',
      })
    })
  })

  describe('isOpenAICompatibleProvider', () => {
    it('identifies compatible providers', () => {
      expect(isOpenAICompatibleProvider('openai')).toBe(true)
      expect(isOpenAICompatibleProvider('openai-web')).toBe(true)
    })

    it('rejects incompatible providers', () => {
      expect(isOpenAICompatibleProvider('anthropic')).toBe(false)
      expect(isOpenAICompatibleProvider('gemini')).toBe(false)
    })
  })
})
