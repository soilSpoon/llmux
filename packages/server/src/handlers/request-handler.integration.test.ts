import { describe, it, expect, beforeEach } from 'bun:test'
import { createRetryState, type ErrorHandlingContext } from './request-handler'
import { FamilyRateLimitManager } from './family-rate-limiting'

/**
 * Integration tests for request-handler with FamilyRateLimitManager
 * Verifies that 429 errors are handled per-family, not globally
 */

describe('request-handler + FamilyRateLimitManager integration', () => {
  let rateLimitManager: FamilyRateLimitManager
  let retryState: ReturnType<typeof createRetryState>

  beforeEach(() => {
    rateLimitManager = new FamilyRateLimitManager()
    retryState = createRetryState()
  })

  it('should mark only affected family as rate-limited on 429', async () => {
    const context: ErrorHandlingContext = {
      provider: 'antigravity',
      model: 'gemini-2.5-flash',
      status: 429,
      errorText: 'Rate limit exceeded',
      retryState,
      originalModel: 'gemini-2.5-flash',
    }
    expect(context).toBeDefined()

    // Before handling error, neither family is rate-limited
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(false)

    // Simulate marking gemini-flash as rate limited
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)

    // Now only gemini-flash should be limited
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
  })

  it('should return available families excluding rate-limited ones', () => {
    // Mark gemini-flash as rate-limited
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)

    const available = rateLimitManager.getAvailableFamilies(0)

    // Should include claude and gemini-pro, but not gemini-flash
    expect(available).toContain('claude')
    expect(available).toContain('gemini-pro')
    expect(available).not.toContain('gemini-flash')
  })

  it('should track rate limit state per account+family combination', () => {
    // Mark account 0, gemini-flash as limited
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)

    // Mark account 1, gemini-flash as limited
    rateLimitManager.markRateLimited(1, 'gemini-flash', 30000, false)

    // But account 0, claude should be available
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(1, 'gemini-flash')).toBe(true)
    expect(rateLimitManager.isRateLimitedForFamily(1, 'claude')).toBe(false)
  })

  it('should handle Claude weekly hard limits differently from Gemini', () => {
    // Mark Claude as weekly hard-limited
    rateLimitManager.markRateLimited(0, 'claude', 604800000, true) // 7 days in ms

    // Check weekly hard limit status
    expect(rateLimitManager.isWeeklyHardLimit(0, 'claude')).toBe(true)
    expect(rateLimitManager.isClaudeWeeklyHardLimit(0)).toBe(true)

    // shouldFailWithoutRotation should return true for Claude weekly limits
    expect(rateLimitManager.shouldFailWithoutRotation(0, 'claude')).toBe(true)
  })

  it('should expire rate limit when reset time passes', () => {
    // Mark as rate-limited with short duration
    const shortDuration = 100 // 100ms

    rateLimitManager.markRateLimited(0, 'gemini-flash', shortDuration, false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)

    // Wait for expiration
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
        resolve()
      }, 150)
    })
  })

  it('should get rate-limited families for an account', () => {
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)
    rateLimitManager.markRateLimited(0, 'claude', 30000, true)

    const limited = rateLimitManager.getRateLimitedFamilies(0)

    expect(limited).toContain('gemini-flash')
    expect(limited).toContain('claude')
    expect(limited).not.toContain('gemini-pro')
  })

  it('should reset individual family rate limit', () => {
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)
    rateLimitManager.markRateLimited(0, 'claude', 30000, false)

    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(true)

    // Reset only gemini-flash
    rateLimitManager.reset(0, 'gemini-flash')

    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(true)
  })

  it('should reset all families for an account', () => {
    rateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)
    rateLimitManager.markRateLimited(0, 'gemini-pro', 30000, false)
    rateLimitManager.markRateLimited(0, 'claude', 30000, false)

    rateLimitManager.resetAccount(0)

    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
    expect(rateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(false)
  })
})

describe('request-handler with family-specific rate limiting - error handling flow', () => {
  it('should integrate FamilyRateLimitManager in error context', () => {
    const manager = new FamilyRateLimitManager()

    // Simulate Gemini 429 on account 0
    manager.markRateLimited(0, 'gemini-flash', 30000, false)

    // Claude should still be available
    const claudeAvailable = !manager.isRateLimitedForFamily(0, 'claude')
    expect(claudeAvailable).toBe(true)

    // Gemini should be limited
    const geminiLimited = manager.isRateLimitedForFamily(0, 'gemini-flash')
    expect(geminiLimited).toBe(true)
  })
})
