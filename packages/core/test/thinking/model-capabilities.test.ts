import { describe, expect, it } from 'bun:test'
import { isThinkingModel } from '../../src/thinking/model-capabilities'

describe('isThinkingModel', () => {
  describe('Claude thinking models', () => {
    it('should return true for claude-3-7-sonnet-thinking', () => {
      expect(isThinkingModel('claude-3-7-sonnet-thinking')).toBe(true)
    })

    it('should return true for claude-sonnet-4-5-thinking', () => {
      expect(isThinkingModel('claude-sonnet-4-5-thinking')).toBe(true)
    })

    it('should return true for claude-sonnet-4-5-thinking-low', () => {
      expect(isThinkingModel('claude-sonnet-4-5-thinking-low')).toBe(true)
    })

    it('should return true for claude-opus-4-5-thinking-high', () => {
      expect(isThinkingModel('claude-opus-4-5-thinking-high')).toBe(true)
    })

    it('should return true regardless of case', () => {
      expect(isThinkingModel('CLAUDE-SONNET-4-5-THINKING')).toBe(true)
      expect(isThinkingModel('Claude-Opus-4-5-Thinking')).toBe(true)
    })

    it('should return false for non-thinking Claude models', () => {
      expect(isThinkingModel('claude-sonnet-4-5')).toBe(false)
      expect(isThinkingModel('claude-3-opus')).toBe(false)
      expect(isThinkingModel('claude-instant-1')).toBe(false)
    })
  })

  describe('Gemini 3 models', () => {
    it('should return true for gemini-3-pro', () => {
      expect(isThinkingModel('gemini-3-pro')).toBe(true)
    })

    it('should return true for gemini-3-flash', () => {
      expect(isThinkingModel('gemini-3-flash')).toBe(true)
    })

    it('should return true for gemini-3-pro-high', () => {
      expect(isThinkingModel('gemini-3-pro-high')).toBe(true)
    })

    it('should return true for gemini-3-flash-low', () => {
      expect(isThinkingModel('gemini-3-flash-low')).toBe(true)
    })

    it('should return true regardless of case', () => {
      expect(isThinkingModel('GEMINI-3-PRO')).toBe(true)
      expect(isThinkingModel('Gemini-3-Flash')).toBe(true)
    })
  })

  describe('Gemini 2.5 models', () => {
    it('should return true for gemini-2.5-flash', () => {
      expect(isThinkingModel('gemini-2.5-flash')).toBe(true)
    })

    it('should return true for gemini-2.5-pro', () => {
      expect(isThinkingModel('gemini-2.5-pro')).toBe(true)
    })
  })

  describe('Non-thinking models', () => {
    it('should return false for gpt-4o', () => {
      expect(isThinkingModel('gpt-4o')).toBe(false)
    })

    it('should return false for gpt-4-turbo', () => {
      expect(isThinkingModel('gpt-4-turbo')).toBe(false)
    })

    it('should return false for gpt-3.5-turbo', () => {
      expect(isThinkingModel('gpt-3.5-turbo')).toBe(false)
    })

    it('should return false for gemini-1.5-pro', () => {
      expect(isThinkingModel('gemini-1.5-pro')).toBe(false)
    })

    it('should return false for gemini-1.0-pro', () => {
      expect(isThinkingModel('gemini-1.0-pro')).toBe(false)
    })
  })

  describe('OpenAI reasoning models', () => {
    it('should return true for o1-preview with openai provider', () => {
      expect(isThinkingModel('o1-preview', 'openai')).toBe(true)
    })

    it('should return true for o1-mini with openai provider', () => {
      expect(isThinkingModel('o1-mini', 'openai')).toBe(true)
    })

    it('should return true for o3 with openai provider', () => {
      expect(isThinkingModel('o3', 'openai')).toBe(true)
    })

    it('should return true for o3-mini with openai provider', () => {
      expect(isThinkingModel('o3-mini', 'openai')).toBe(true)
    })

    it('should return false for o1-preview without provider', () => {
      expect(isThinkingModel('o1-preview')).toBe(false)
    })
  })

  describe('Provider parameter', () => {
    it('should work with antigravity provider', () => {
      expect(isThinkingModel('claude-sonnet-4-5-thinking', 'antigravity')).toBe(true)
      expect(isThinkingModel('gemini-3-pro', 'antigravity')).toBe(true)
    })

    it('should work with anthropic provider', () => {
      expect(isThinkingModel('claude-3-7-sonnet-thinking', 'anthropic')).toBe(true)
    })

    it('should work with gemini provider', () => {
      expect(isThinkingModel('gemini-3-flash', 'gemini')).toBe(true)
    })

    it('should work with google as provider alias', () => {
      expect(isThinkingModel('gemini-3-pro', 'google')).toBe(true)
    })

    it('should work with unknown provider', () => {
      expect(isThinkingModel('claude-sonnet-4-5-thinking', 'unknown-provider')).toBe(true)
      expect(isThinkingModel('gpt-4o', 'unknown-provider')).toBe(false)
    })
  })
})
