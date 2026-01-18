import { describe, expect, it } from 'bun:test'
import {
  AnthropicBackoffStrategy,
  DefaultBackoffStrategy,
  GeminiBackoffStrategy,
  getBackoffStrategy,
} from '@llmux/core'

describe('Backoff Strategies', () => {
  describe('DefaultBackoffStrategy', () => {
    it('implements exponential backoff', () => {
      const strategy = new DefaultBackoffStrategy()
      
      // 1000 * 2^0 = 1000
      expect(strategy.getDelayMs({ attempt: 0 })).toBe(1000)
      
      // 1000 * 2^1 = 2000
      expect(strategy.getDelayMs({ attempt: 1 })).toBe(2000)
      
      // 1000 * 2^2 = 4000
      expect(strategy.getDelayMs({ attempt: 2 })).toBe(4000)
    })

    it('caps max delay at 30 seconds', () => {
      const strategy = new DefaultBackoffStrategy()
      // 1000 * 2^10 = 1024000 > 30000
      expect(strategy.getDelayMs({ attempt: 10 })).toBe(30000)
    })
  })

  describe('AnthropicBackoffStrategy', () => {
    it('respects Retry-After header', () => {
      const strategy = new AnthropicBackoffStrategy()
      const delay = strategy.getDelayMs({
        attempt: 0,
        headers: { 'retry-after': '42' }
      })
      expect(delay).toBe(42000)
    })

    it('respects case-insensitive Retry-After header', () => {
      const strategy = new AnthropicBackoffStrategy()
      const delay = strategy.getDelayMs({
        attempt: 0,
        headers: { 'Retry-After': '15' }
      })
      expect(delay).toBe(15000)
    })

    it('falls back to exponential with jitter when header missing', () => {
      const strategy = new AnthropicBackoffStrategy()
      const delay = strategy.getDelayMs({ attempt: 0 })
      
      // Base is 1000, jitter is up to 20%
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThan(1200)
    })
  })

  describe('GeminiBackoffStrategy', () => {
    it('uses faster backoff', () => {
      const strategy = new GeminiBackoffStrategy()
      
      // 500 * 2^0 = 500
      expect(strategy.getDelayMs({ attempt: 0 })).toBe(500)
      
      // 500 * 2^1 = 1000
      expect(strategy.getDelayMs({ attempt: 1 })).toBe(1000)
    })

    it('caps at lower max delay', () => {
      const strategy = new GeminiBackoffStrategy()
      // 500 * 2^10 > 10000
      expect(strategy.getDelayMs({ attempt: 10 })).toBe(10000)
    })
  })

  describe('getBackoffStrategy', () => {
    it('returns provider specific strategies', () => {
      expect(getBackoffStrategy('anthropic')).toBeInstanceOf(AnthropicBackoffStrategy)
      expect(getBackoffStrategy('gemini')).toBeInstanceOf(GeminiBackoffStrategy)
      expect(getBackoffStrategy('google')).toBeInstanceOf(GeminiBackoffStrategy)
      expect(getBackoffStrategy('gemini-cli')).toBeInstanceOf(GeminiBackoffStrategy)
    })

    it('returns default strategy for unknown providers', () => {
      expect(getBackoffStrategy('openai')).toBeInstanceOf(DefaultBackoffStrategy)
      // @ts-expect-error testing unknown provider
      expect(getBackoffStrategy('unknown-provider')).toBeInstanceOf(DefaultBackoffStrategy)
    })
  })
})
