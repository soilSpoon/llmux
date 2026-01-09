import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * Tests for family-specific rate limiting
 * Ensures that rate limiting is tracked per model family (gemini-flash, gemini-pro, claude)
 * rather than globally, allowing parallel families to continue when one is rate-limited.
 */

type ModelFamily = 'gemini-flash' | 'gemini-pro' | 'claude'

interface RateLimitEntry {
  family: ModelFamily
  resetTime: number
}

class FamilyRateLimitManager {
  private limits: Map<string, RateLimitEntry> = new Map()

  markRateLimited(accountIndex: number, family: ModelFamily, resetTimeMs: number): void {
    const key = `account-${accountIndex}:${family}`
    this.limits.set(key, { family, resetTime: Date.now() + resetTimeMs })
  }

  isRateLimitedForFamily(accountIndex: number, family: ModelFamily): boolean {
    const key = `account-${accountIndex}:${family}`
    const entry = this.limits.get(key)
    if (!entry) return false

    // Check if reset time has passed
    if (Date.now() > entry.resetTime) {
      this.limits.delete(key)
      return false
    }

    return true
  }

  getAvailableFamilies(accountIndex: number): ModelFamily[] {
    const families: ModelFamily[] = ['gemini-flash', 'gemini-pro', 'claude']
    return families.filter((family) => !this.isRateLimitedForFamily(accountIndex, family))
  }

  reset(accountIndex: number, family: ModelFamily): void {
    const key = `account-${accountIndex}:${family}`
    this.limits.delete(key)
  }
}

describe('family-specific rate limiting', () => {
  let manager: FamilyRateLimitManager

  beforeEach(() => {
    manager = new FamilyRateLimitManager()
  })

  it('should mark rate limit for specific family only', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)

    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(manager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
    expect(manager.isRateLimitedForFamily(0, 'claude')).toBe(false)
  })

  it('should allow other families to be selected when one is rate-limited', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)

    const available = manager.getAvailableFamilies(0)
    expect(available).toEqual(['gemini-pro', 'claude'])
  })

  it('should Claude 429 does not affect Gemini availability', () => {
    manager.markRateLimited(0, 'claude', 30000)

    expect(manager.isRateLimitedForFamily(0, 'claude')).toBe(true)
    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
    expect(manager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
  })

  it('should Gemini-flash 429 does not affect gemini-pro availability', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)

    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(manager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
    expect(manager.isRateLimitedForFamily(0, 'claude')).toBe(false)
  })

  it('should track multiple accounts independently', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)
    manager.markRateLimited(1, 'claude', 30000)

    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(manager.isRateLimitedForFamily(0, 'claude')).toBe(false)

    expect(manager.isRateLimitedForFamily(1, 'claude')).toBe(true)
    expect(manager.isRateLimitedForFamily(1, 'gemini-flash')).toBe(false)
  })

  it('should reset rate limit for specific family', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)
    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)

    manager.reset(0, 'gemini-flash')
    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
  })

  it('should handle reset time expiration', () => {
    // Mark rate limit with 10ms duration
    manager.markRateLimited(0, 'gemini-flash', 10)

    // Should be rate limited immediately
    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)

    // Wait for expiration
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)

    // Should no longer be rate limited
    expect(manager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
  })

  it('should return correct available families with multiple limits', () => {
    manager.markRateLimited(0, 'gemini-flash', 30000)
    manager.markRateLimited(0, 'claude', 30000)

    const available = manager.getAvailableFamilies(0)
    expect(available).toEqual(['gemini-pro'])
  })

  it('should allow all families when none are rate-limited', () => {
    const available = manager.getAvailableFamilies(0)
    expect(available).toEqual(['gemini-flash', 'gemini-pro', 'claude'])
  })
})
