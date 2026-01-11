/**
 * Family-specific rate limit tracking
 * Tracks rate limits per model family (e.g., gemini-flash, gemini-pro, claude)
 * rather than globally, allowing parallel families to continue when one is rate-limited
 */

export type ModelFamily = 'gemini-flash' | 'gemini-pro' | 'claude' | 'unknown'

interface RateLimitEntry {
  family: ModelFamily
  resetTime: number
  isWeeklyHardLimit: boolean
}

export class FamilyRateLimitManager {
  private limits: Map<string, RateLimitEntry> = new Map()

  /**
   * Mark an account+family as rate-limited
   * For Claude, tracks weekly semantics (much longer reset time)
   */
  markRateLimited(
    accountIndex: number,
    family: ModelFamily,
    resetTimeMs: number,
    isWeeklyHardLimit: boolean = false
  ): void {
    const key = `account-${accountIndex}:${family}`

    this.limits.set(key, {
      family,
      resetTime: Date.now() + resetTimeMs,
      isWeeklyHardLimit,
    })
  }

  /**
   * Check if an account is rate-limited for a specific family
   */
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

  /**
   * Get available model families for an account
   */
  getAvailableFamilies(accountIndex: number): ModelFamily[] {
    const families: ModelFamily[] = ['gemini-flash', 'gemini-pro', 'claude']
    return families.filter((family) => !this.isRateLimitedForFamily(accountIndex, family))
  }

  /**
   * Check if a rate limit is a weekly hard limit (Claude)
   * These cannot be recovered until the weekly reset
   */
  isWeeklyHardLimit(accountIndex: number, family: ModelFamily): boolean {
    const key = `account-${accountIndex}:${family}`
    const entry = this.limits.get(key)
    return entry?.isWeeklyHardLimit ?? false
  }

  /**
   * Check if Claude family has a weekly hard limit
   * These cannot be recovered until the weekly reset
   */
  isClaudeWeeklyHardLimit(accountIndex: number): boolean {
    return this.isWeeklyHardLimit(accountIndex, 'claude')
  }

  /**
   * Check if should fail without rotation (Claude weekly limits)
   */
  shouldFailWithoutRotation(accountIndex: number): boolean {
    return this.isClaudeWeeklyHardLimit(accountIndex)
  }

  /**
   * Can rotate for a specific family
   * Claude with weekly limits cannot rotate, others can
   */
  canRotateForFamily(_family: ModelFamily): boolean {
    // Claude can rotate within Claude accounts, but if weekly hard limit hit, cannot rotate to Gemini
    // For now, return true for all families - rotation logic is handled elsewhere
    return true
  }

  /**
   * Reset rate limit for a specific family on an account
   */
  reset(accountIndex: number, family: ModelFamily): void {
    const key = `account-${accountIndex}:${family}`
    this.limits.delete(key)
  }

  /**
   * Reset all rate limits for an account
   */
  resetAccount(accountIndex: number): void {
    const keysToDelete: string[] = []
    for (const key of this.limits.keys()) {
      if (key.startsWith(`account-${accountIndex}:`)) {
        keysToDelete.push(key)
      }
    }
    for (const key of keysToDelete) {
      this.limits.delete(key)
    }
  }

  /**
   * Get all rate-limited families for an account
   */
  getRateLimitedFamilies(accountIndex: number): ModelFamily[] {
    const families: ModelFamily[] = ['gemini-flash', 'gemini-pro', 'claude']
    return families.filter((family) => this.isRateLimitedForFamily(accountIndex, family))
  }
}

// Singleton instance
export const familyRateLimitManager: FamilyRateLimitManager = new FamilyRateLimitManager()
