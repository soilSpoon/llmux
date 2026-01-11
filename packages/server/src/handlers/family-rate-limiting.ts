/**
 * Family-specific rate limit tracking
 * Tracks rate limits per model family (e.g., gemini-flash, gemini-pro, claude)
 * rather than globally, allowing parallel families to continue when one is rate-limited
 */
import type { ProviderName } from '@llmux/core'

export type ModelFamily = 'gemini-flash' | 'gemini-pro' | 'claude' | 'unknown'

/**
 * Determine model family from model name and provider
 * Used for family-specific rate limiting
 */
export function getModelFamily(model: string, provider: ProviderName | string): ModelFamily {
  const lowerModel = model.toLowerCase()

  if (provider === 'anthropic' || lowerModel.includes('claude')) {
    return 'claude'
  }

  if (lowerModel.includes('flash')) {
    return 'gemini-flash'
  }

  if (lowerModel.includes('pro') || lowerModel.includes('thinking')) {
    return 'gemini-pro'
  }

  // Default to gemini-flash for Gemini models
  if (provider === 'antigravity' || lowerModel.includes('gemini')) {
    return 'gemini-flash'
  }

  return 'unknown'
}

/**
 * Check if a Claude model rate limit is likely a weekly hard limit
 * Weekly limits occur when usage exceeds quota and cannot be recovered until reset
 */
export function isClaudeWeeklyLimit(model: string): boolean {
  // Heuristic: Claude models usually have weekly hard limits
  // This is a conservative check; actual detection would require API headers
  return model.toLowerCase().includes('claude')
}

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
   * Check if should fail without rotation (e.g. Claude weekly limits)
   * If the specific family has a hard limit, we should not rotate to other accounts/families blindly
   * unless the rotation manager handles it. But here we define "fail without rotation" as "stop trying".
   */
  shouldFailWithoutRotation(accountIndex: number, family: ModelFamily): boolean {
    // Only Claude has weekly hard limits that define "account is dead for this family"
    // Gemini 429s are usually temporary (minute/day quota) and can be rotated.
    if (family === 'claude') {
      return this.isClaudeWeeklyHardLimit(accountIndex)
    }
    return false
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
  /**
   * Reset all rate limits (for testing)
   */
  clear(): void {
    this.limits.clear()
  }
}

// Singleton instance
export const familyRateLimitManager: FamilyRateLimitManager = new FamilyRateLimitManager()
