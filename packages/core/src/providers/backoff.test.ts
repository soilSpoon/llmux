import { describe, expect, it } from 'bun:test'
import {
  AnthropicBackoffStrategy,
  DefaultBackoffStrategy,
  GeminiBackoffStrategy,
  getBackoffStrategy,
} from './backoff'
import type { BackoffContext } from './backoff'

describe('DefaultBackoffStrategy', () => {
  const strategy = new DefaultBackoffStrategy()

  it('calculates exponential backoff', () => {
    // attempt 1: 1000 * 2^0 = 1000
    // attempt 2: 1000 * 2^1 = 2000
    // attempt 3: 1000 * 2^2 = 4000
    
    // We check ranges because of jitter
    const attempts = [1, 2, 3]
    const baseDelays = [1000, 2000, 4000]

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      const baseDelay = baseDelays[i]
      
      if (baseDelay === undefined || attempt === undefined) continue

      // Jitter is +/- 50%
      const min = baseDelay * 0.5
      const max = baseDelay * 1.5
      
      const context: BackoffContext = { attempt }
      const delay = strategy.getDelayMs(context)
      
      expect(delay).toBeGreaterThanOrEqual(min)
      expect(delay).toBeLessThanOrEqual(max)
    }
  })

  it('respects Retry-After header (seconds)', () => {
    const context: BackoffContext = {
      attempt: 1,
      headers: { 'retry-after': '5' }, // 5 seconds
    }
    const delay = strategy.getDelayMs(context)
    expect(delay).toBe(5000)
  })

  it('respects Retry-After header (HTTP Date)', () => {
    const future = new Date(Date.now() + 10000) // 10 seconds from now
    const context: BackoffContext = {
      attempt: 1,
      headers: { 'retry-after': future.toUTCString() },
    }
    const delay = strategy.getDelayMs(context)
    
    // Allow small delta for execution time
    expect(delay).toBeGreaterThan(9000) 
    expect(delay).toBeLessThan(11000)
  })

  it('handles case-insensitive headers', () => {
    const context: BackoffContext = {
      attempt: 1,
      headers: { 'Retry-After': '5' },
    }
    const delay = strategy.getDelayMs(context)
    expect(delay).toBe(5000)
  })
})

describe('AnthropicBackoffStrategy', () => {
  it('uses anthropic defaults', () => {
    const strategy = new AnthropicBackoffStrategy()
    // Same defaults as default strategy currently, but separated for future extensibility
    // attempt 1: ~1000ms
    const context = { attempt: 1 }
    const delay = strategy.getDelayMs(context)
    expect(delay).toBeGreaterThan(500)
    expect(delay).toBeLessThan(1500)
  })
})

describe('GeminiBackoffStrategy', () => {
  it('caps at gemini max delay', () => {
    const strategy = new GeminiBackoffStrategy()
    // attempt 10 would be huge normally, but should cap at 10000
    const context = { attempt: 10 }
    const delay = strategy.getDelayMs(context)
    expect(delay).toBeLessThanOrEqual(10000)
  })
})

describe('getBackoffStrategy', () => {
  it('returns correct strategy for provider', () => {
    expect(getBackoffStrategy('anthropic')).toBeInstanceOf(AnthropicBackoffStrategy)
    expect(getBackoffStrategy('google')).toBeInstanceOf(GeminiBackoffStrategy)
    expect(getBackoffStrategy('gemini')).toBeInstanceOf(GeminiBackoffStrategy)
    expect(getBackoffStrategy('gemini-cli')).toBeInstanceOf(GeminiBackoffStrategy)
    expect(getBackoffStrategy('openai')).toBeInstanceOf(DefaultBackoffStrategy)
  })
})
