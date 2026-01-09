import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * Tests for Claude-specific rate limit handling
 * Claude has weekly hard limits distinct from Gemini's 5-hour quota resets
 */

type ModelFamily = 'gemini' | 'claude'

interface RateLimitState {
  family: ModelFamily
  resetTime: number
  isWeeklyHardLimit: boolean
}

class ClaudeRateLimitHandler {
  private limits: Map<string, RateLimitState> = new Map()

  /**
   * Mark an account+family as rate-limited
   * For Claude, tracks weekly semantics (much longer reset time)
   */
  markRateLimited(accountIndex: number, family: ModelFamily, resetTimeMs: number): void {
    const isWeekly = family === 'claude'
    const key = `account-${accountIndex}:${family}`

    this.limits.set(key, {
      family,
      resetTime: Date.now() + resetTimeMs,
      isWeeklyHardLimit: isWeekly,
    })
  }

  isRateLimitedForFamily(accountIndex: number, family: ModelFamily): boolean {
    const key = `account-${accountIndex}:${family}`
    const state = this.limits.get(key)
    if (!state) return false

    // Check if reset time has passed
    if (Date.now() > state.resetTime) {
      this.limits.delete(key)
      return false
    }

    return true
  }

  /**
   * Check if a rate limit is a weekly hard limit (Claude)
   * These cannot be recovered until the weekly reset
   */
  isWeeklyHardLimit(accountIndex: number): boolean {
    const claudeKey = `account-${accountIndex}:claude`
    const state = this.limits.get(claudeKey)
    return state?.isWeeklyHardLimit ?? false
  }

  /**
   * Claude 429 handling: safe fail (no cross-family rotation)
   * Returns true if should fail gracefully without rotating to Gemini
   */
  shouldFailWithoutRotation(accountIndex: number): boolean {
    return this.isWeeklyHardLimit(accountIndex)
  }

  /**
   * Gemini 429 handling: can rotate to next account
   */
  canRotateForFamily(family: ModelFamily): boolean {
    // Gemini can rotate, Claude weekly limits cannot
    return family !== 'claude'
  }

  reset(accountIndex: number, family: ModelFamily): void {
    const key = `account-${accountIndex}:${family}`
    this.limits.delete(key)
  }
}

describe('Claude-specific rate limiting', () => {
  let handler: ClaudeRateLimitHandler

  beforeEach(() => {
    handler = new ClaudeRateLimitHandler()
  })

  it('should track Claude weekly limits separately', () => {
    handler.markRateLimited(0, 'claude', 604800000) // 7 days in ms
    handler.markRateLimited(0, 'gemini', 18000000) // 5 hours in ms

    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(true)
    expect(handler.isRateLimitedForFamily(0, 'gemini')).toBe(true)
  })

  it('should identify Claude 429 as weekly hard limit', () => {
    handler.markRateLimited(0, 'claude', 604800000)

    expect(handler.isWeeklyHardLimit(0)).toBe(true)
  })

  it('should not identify Gemini 429 as weekly hard limit', () => {
    handler.markRateLimited(0, 'gemini', 18000000)

    expect(handler.isWeeklyHardLimit(0)).toBe(false)
  })

  it('should Claude 429 does not trigger rotation to Gemini', () => {
    handler.markRateLimited(0, 'claude', 604800000)

    const shouldRotate = handler.shouldFailWithoutRotation(0)
    expect(shouldRotate).toBe(true)
  })

  it('should Gemini 429 allows rotation to next account', () => {
    handler.markRateLimited(0, 'gemini', 18000000)

    const canRotate = handler.canRotateForFamily('gemini')
    expect(canRotate).toBe(true)
  })

  it('should track both families independently on same account', () => {
    handler.markRateLimited(0, 'claude', 604800000)
    handler.markRateLimited(0, 'gemini', 18000000)

    const claudeLimit = handler.isWeeklyHardLimit(0)
    const geminiCanRotate = handler.canRotateForFamily('gemini')

    expect(claudeLimit).toBe(true)
    expect(geminiCanRotate).toBe(true)
  })

  it('should reset Claude limit when ready', () => {
    handler.markRateLimited(0, 'claude', 10) // Very short duration
    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(true)

    // Simulate time passing
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)

    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(false)
  })

  it('should handle multiple accounts with Claude limits', () => {
    handler.markRateLimited(0, 'claude', 604800000)
    handler.markRateLimited(1, 'claude', 604800000)
    handler.markRateLimited(2, 'gemini', 18000000)

    expect(handler.isWeeklyHardLimit(0)).toBe(true)
    expect(handler.isWeeklyHardLimit(1)).toBe(true)
    expect(handler.isWeeklyHardLimit(2)).toBe(false)
  })

  it('should not allow cross-family fallback for Claude exhaustion', () => {
    // Mark all Claude accounts as exhausted with weekly limits
    handler.markRateLimited(0, 'claude', 604800000)
    handler.markRateLimited(1, 'claude', 604800000)

    // When Claude is exhausted, should fail gracefully
    const shouldFailAccount0 = handler.shouldFailWithoutRotation(0)
    const shouldFailAccount1 = handler.shouldFailWithoutRotation(1)

    expect(shouldFailAccount0).toBe(true)
    expect(shouldFailAccount1).toBe(true)
  })

  it('should log warning for unrecoverable Claude limits', () => {
    handler.markRateLimited(0, 'claude', 604800000)

    const isUnrecoverable = handler.isWeeklyHardLimit(0) && !handler.canRotateForFamily('claude')

    expect(isUnrecoverable).toBe(true)
  })

  it('should distinguish rate limit reset times', () => {
    const claudeResetMs = 604800000 // 7 days
    const geminiResetMs = 18000000 // 5 hours

    handler.markRateLimited(0, 'claude', claudeResetMs)
    handler.markRateLimited(0, 'gemini', geminiResetMs)

    // Both should be marked as limited initially
    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(true)
    expect(handler.isRateLimitedForFamily(0, 'gemini')).toBe(true)

    // Verify they have different reset semantics
    expect(handler.isWeeklyHardLimit(0)).toBe(true)
    expect(handler.canRotateForFamily('claude')).toBe(false)
    expect(handler.canRotateForFamily('gemini')).toBe(true)
  })

  it('should handle manual reset for testing', () => {
    handler.markRateLimited(0, 'claude', 604800000)
    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(true)

    handler.reset(0, 'claude')
    expect(handler.isRateLimitedForFamily(0, 'claude')).toBe(false)
  })
})
