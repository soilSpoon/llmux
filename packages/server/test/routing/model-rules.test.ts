import { beforeAll, describe, expect, it } from 'bun:test'
import {
  AntigravityProvider,
  AnthropicProvider,
  GeminiProvider,
  OpenAIProvider,
  OpenAIWebProvider,
  OpencodeZenProvider,
  clearProviders,
  registerProvider,
} from '@llmux/core'
import {
  inferProviderFromModel,
  isOpenAICompatibleProvider,
  isOpenAIModel,
  parseExplicitProvider,
} from '../../src/routing/model-rules'

describe('model-rules', () => {
  beforeAll(() => {
    clearProviders()
    registerProvider(new OpenAIProvider())
    registerProvider(new AnthropicProvider())
    registerProvider(new GeminiProvider())
    registerProvider(new AntigravityProvider())
    registerProvider(new OpencodeZenProvider())
    registerProvider(new OpenAIWebProvider())
  })

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
      // Assuming last part is checked if it matches a provider
      expect(parseExplicitProvider('ft:gpt-3.5:org:openai')).toEqual({
        model: 'ft:gpt-3.5:org',
        provider: 'openai',
      })
      expect(parseExplicitProvider('ft:gpt-3.5:org:custom')).toEqual({
        model: 'ft:gpt-3.5:org:custom',
      })
    })
  })

  describe('inferProviderFromModel', () => {
    it('infers antigravity models', () => {
      expect(inferProviderFromModel('gemini-claude-sonnet')).toBe('antigravity')
      expect(inferProviderFromModel('some-model-antigravity')).toBe('antigravity')
      // Internal models that should default to antigravity
      expect(inferProviderFromModel('gemini-3-pro-high')).toBe('antigravity')
      expect(inferProviderFromModel('gemini-3-flash-preview')).toBe('antigravity')
      expect(inferProviderFromModel('gemini-3-pro-preview')).toBe('antigravity')
    })

    it('infers opencode-zen models', () => {
      expect(inferProviderFromModel('glm-4.7-free')).toBe('opencode-zen')
      expect(inferProviderFromModel('big-pickle')).toBe('opencode-zen')
      expect(inferProviderFromModel('qwen-max')).toBe('opencode-zen')
      expect(inferProviderFromModel('kimi-chat')).toBe('opencode-zen')
      expect(inferProviderFromModel('grok-1')).toBe('opencode-zen')
    })

    it('infers anthropic models', () => {
      expect(inferProviderFromModel('claude-3-opus')).toBe('anthropic')
      expect(inferProviderFromModel('claude-2')).toBe('anthropic')
    })

    it('infers openai-web models', () => {
      expect(inferProviderFromModel('gpt-5')).toBe('openai-web')
      expect(inferProviderFromModel('gpt-5-preview')).toBe('openai-web')
      expect(inferProviderFromModel('code-davinci-002-codex')).toBe('openai-web')
    })

    it('infers openai models', () => {
      expect(inferProviderFromModel('gpt-4')).toBe('openai')
      expect(inferProviderFromModel('gpt-3.5-turbo')).toBe('openai')
      expect(inferProviderFromModel('o1-preview')).toBe('openai')
      expect(inferProviderFromModel('o3-mini')).toBe('openai')
    })

    it('infers gemini models', () => {
      expect(inferProviderFromModel('gemini-pro')).toBe('gemini')
      expect(inferProviderFromModel('gemini-1.5-flash')).toBe('gemini')
    })

    it('defaults to openai for unknown models', () => {
      expect(inferProviderFromModel('unknown-model')).toBe('openai')
      expect(inferProviderFromModel('llama-3')).toBe('openai') // Unless we add specific rules
    })
  })

  describe('isOpenAIModel', () => {
    it('identifies OpenAI models', () => {
      expect(isOpenAIModel('gpt-4')).toBe(true)
      expect(isOpenAIModel('o1-preview')).toBe(true)
      expect(isOpenAIModel('some-codex-model')).toBe(true)
    })

    it('rejects non-OpenAI models', () => {
      expect(isOpenAIModel('claude-3')).toBe(false)
      expect(isOpenAIModel('gemini-pro')).toBe(false)
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
