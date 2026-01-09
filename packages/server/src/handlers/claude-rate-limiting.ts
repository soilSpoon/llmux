/**
 * Claude-specific rate limit handling
 * Claude has weekly hard limits distinct from Gemini's 5-hour quota resets
 */

export type ModelFamily = 'gemini' | 'claude'

interface RateLimitState {
  family: ModelFamily
  resetTime: number
  isWeeklyHardLimit: boolean
}

export class ClaudeRateLimitHandler {
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

  /**
   * Check if an account is rate-limited for a specific family
   */
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

  /**
   * Reset rate limit for a specific family on an account
   */
  reset(accountIndex: number, family: ModelFamily): void {
    const key = `account-${accountIndex}:${family}`
    this.limits.delete(key)
  }
}
