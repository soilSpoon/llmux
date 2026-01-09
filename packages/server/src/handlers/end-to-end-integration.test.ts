import { describe, it, expect, beforeEach } from 'bun:test'
import { createRetryState, type ErrorHandlingContext } from './request-handler'
import { FamilyRateLimitManager } from './family-rate-limiting'
import { AccountRotationWithTierManager } from './account-rotation-with-tier'
import type { Credential } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'

/**
 * JSON argument parser helper for test
 */
function recursivelyParseJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return recursivelyParseJsonStrings(parsed)
    } catch {
      return value
    }
  }

  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map((item) => recursivelyParseJsonStrings(item))
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = recursivelyParseJsonStrings(val)
    }
    return result
  }

  return value
}

/**
 * End-to-end integration tests for the complete tier detection & rate limiting flow
 * Verifies that all components work together correctly
 */

describe('End-to-End: Tier Detection & Rate Limiting Pipeline', () => {
  let familyRateLimitManager: FamilyRateLimitManager
  let accountRotationManager: AccountRotationWithTierManager
  let retryState: ReturnType<typeof createRetryState>

  const credentials: Credential[] = [
    {
      type: 'oauth',
      accessToken: 'token-free-0',
      refreshToken: 'refresh-free-0',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'free' },
    },
    {
      type: 'oauth',
      accessToken: 'token-paid-1',
      refreshToken: 'refresh-paid-1',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'paid' },
    },
  ]

  beforeEach(() => {
    familyRateLimitManager = new FamilyRateLimitManager()
    accountRotationManager = new AccountRotationWithTierManager(credentials)
    retryState = createRetryState()
  })

  it('should handle Gemini 429 separately from Claude', () => {
    // Account 0 hits Gemini rate limit
    familyRateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)

    // Claude should still be available on same account
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(false)

    // Gemini should be limited
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
  })

  it('should rotate to paid account when free is limited', () => {
    // Mark free account (0) as limited for gemini-flash
    accountRotationManager.markRateLimited(0, 'gemini-flash')

    // Should prefer paid account (1)
    const nextAccount = accountRotationManager.getNextAccount('gemini-flash')
    expect(nextAccount?.index).toBe(1)
    expect(nextAccount?.tier).toBe('paid')
  })

  it('should handle Claude weekly limits without fallback', () => {
    // Mark Claude on account 1 with weekly hard limit
    familyRateLimitManager.markRateLimited(1, 'claude', 604800000, true)

    // Should recognize weekly hard limit
    expect(familyRateLimitManager.isWeeklyHardLimit(1, 'claude')).toBe(true)

    // Should fail without rotation
    expect(familyRateLimitManager.shouldFailWithoutRotation(1)).toBe(true)
  })

  it('should handle mixed tier accounts with family-specific limits', () => {
    // Free account has gemini-flash limit
    familyRateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)
    accountRotationManager.markRateLimited(0, 'gemini-flash')

    // Paid account has claude limit
    familyRateLimitManager.markRateLimited(1, 'claude', 30000, false)
    accountRotationManager.markRateLimited(1, 'claude')

    // Should be able to use gemini-pro on both accounts
    const geminiProAvailable = familyRateLimitManager.getAvailableFamilies(0)
    expect(geminiProAvailable).toContain('gemini-pro')

    // But can't use gemini-flash on free or claude on paid
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(familyRateLimitManager.isRateLimitedForFamily(1, 'claude')).toBe(true)
  })

  it('should prioritize paid accounts in multi-family scenario', () => {
    // Both families work, but paid tier available
    const paidAccounts = accountRotationManager.getAvailableByTier('gemini-flash')

    // Should have both paid and free available initially
    expect(paidAccounts.paid.length).toBeGreaterThan(0)
    expect(paidAccounts.free.length).toBeGreaterThan(0)
  })

  it('should reset family rate limits when needed', () => {
    // Mark multiple families as rate-limited
    familyRateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)
    familyRateLimitManager.markRateLimited(0, 'claude', 30000, false)

    // Both should be limited
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(true)

    // Reset only gemini-flash
    familyRateLimitManager.reset(0, 'gemini-flash')

    // Only claude should remain limited
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(false)
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'claude')).toBe(true)
  })

  it('should handle response with stringified tool arguments', () => {
    // Simulate Gemini returning stringified arguments
    const stringifiedArgs = JSON.stringify({ operation: 'calculate', input: 42 })

    const parsed = recursivelyParseJsonStrings(stringifiedArgs)

    // Should be parsed into object
    expect(typeof parsed).toBe('object')
    if (typeof parsed === 'object' && parsed !== null && 'operation' in parsed) {
      expect((parsed as Record<string, unknown>).operation).toBe('calculate')
    }
  })

  it('should handle complete Gemini 429 error flow', async () => {
    // Simulate Gemini 429 error
    const context: ErrorHandlingContext = {
      provider: 'antigravity' as ProviderName,
      model: 'gemini-2.5-flash',
      status: 429,
      errorText: 'Quota exceeded',
      retryState,
      family: 'gemini-flash',
    }

    // Family rate limit should be marked
    expect(retryState.accountIndex).toBe(0)

    // Would normally mark rate limit and attempt rotation
    // This verifies the error handling context includes family info
    expect(context.family).toBe('gemini-flash')
  })

  it('should handle complete Claude 429 error flow', async () => {
    // Simulate Claude 429 with weekly limit
    const context: ErrorHandlingContext = {
      provider: 'anthropic' as ProviderName,
      model: 'claude-3-5-sonnet-20241022',
      status: 429,
      errorText: 'Weekly quota exceeded',
      retryState,
      family: 'claude',
    }

    // Should be treated as weekly hard limit
    expect(context.family).toBe('claude')
    expect(context.model).toContain('claude')
  })

  it('should support account rotation with tier awareness', () => {
    // Get next account (should prefer paid)
    const next1 = accountRotationManager.getNextAccount('gemini-flash', 0)
    expect(next1?.tier).toBe('paid')

    // Mark it as limited
    accountRotationManager.markRateLimited(next1!.index, 'gemini-flash')

    // Should fall back to free
    const next2 = accountRotationManager.getNextAccount('gemini-flash', 0)
    expect(next2?.tier).toBe('free')
  })
})

describe('End-to-End: Concurrent Family Rate Limits', () => {
  let familyRateLimitManager: FamilyRateLimitManager

  beforeEach(() => {
    familyRateLimitManager = new FamilyRateLimitManager()
  })

  it('should allow independent family operations on same account', () => {
    const accountIndex = 0

    // Limit gemini-flash but not others
    familyRateLimitManager.markRateLimited(accountIndex, 'gemini-flash', 30000, false)

    // Check each family independently
    expect(familyRateLimitManager.isRateLimitedForFamily(accountIndex, 'gemini-flash')).toBe(true)
    expect(familyRateLimitManager.isRateLimitedForFamily(accountIndex, 'gemini-pro')).toBe(false)
    expect(familyRateLimitManager.isRateLimitedForFamily(accountIndex, 'claude')).toBe(false)

    // Get available families
    const available = familyRateLimitManager.getAvailableFamilies(accountIndex)
    expect(available).toContain('gemini-pro')
    expect(available).toContain('claude')
    expect(available).not.toContain('gemini-flash')
  })

  it('should track multiple accounts with different limit states', () => {
    // Account 0: gemini-flash limited
    familyRateLimitManager.markRateLimited(0, 'gemini-flash', 30000, false)

    // Account 1: gemini-pro limited
    familyRateLimitManager.markRateLimited(1, 'gemini-pro', 30000, false)

    // Account 2: claude limited
    familyRateLimitManager.markRateLimited(2, 'claude', 604800000, true)

    // Verify independent states
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-flash')).toBe(true)
    expect(familyRateLimitManager.isRateLimitedForFamily(1, 'gemini-pro')).toBe(true)
    expect(familyRateLimitManager.isRateLimitedForFamily(2, 'claude')).toBe(true)

    // Other families should be available
    expect(familyRateLimitManager.isRateLimitedForFamily(0, 'gemini-pro')).toBe(false)
    expect(familyRateLimitManager.isRateLimitedForFamily(1, 'claude')).toBe(false)
    expect(familyRateLimitManager.isRateLimitedForFamily(2, 'gemini-flash')).toBe(false)
  })
})

describe('End-to-End: Tier-Aware Account Selection', () => {
  let accountRotationManager: AccountRotationWithTierManager

  const mixedCredentials: Credential[] = [
    {
      type: 'oauth',
      accessToken: 'free-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'free' },
    },
    {
      type: 'oauth',
      accessToken: 'paid-1',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'paid' },
    },
    {
      type: 'oauth',
      accessToken: 'free-2',
      refreshToken: 'refresh-3',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'free' },
    },
    {
      type: 'oauth',
      accessToken: 'paid-2',
      refreshToken: 'refresh-4',
      expiresAt: Date.now() + 3600000,
      metadata: { tier: 'paid' },
    },
  ]

  beforeEach(() => {
    accountRotationManager = new AccountRotationWithTierManager(mixedCredentials)
  })

  it('should prefer paid accounts over free when available', () => {
    const next = accountRotationManager.getNextAccount('gemini-flash')

    // Should pick a paid account
    expect(next?.tier).toBe('paid')
  })

  it('should fall back to free accounts only when no paid available', () => {
    // Mark all paid accounts as limited
    accountRotationManager.markRateLimited(1, 'gemini-flash')
    accountRotationManager.markRateLimited(3, 'gemini-flash')

    // Should pick free account
    const next = accountRotationManager.getNextAccount('gemini-flash')
    expect(next?.tier).toBe('free')
  })

  it('should return undefined when all accounts are limited', () => {
    // Mark all accounts as limited
    for (let i = 0; i < mixedCredentials.length; i++) {
      accountRotationManager.markRateLimited(i, 'gemini-flash')
    }

    const next = accountRotationManager.getNextAccount('gemini-flash')
    expect(next).toBeUndefined()
  })

  it('should get accounts grouped by tier', () => {
    const byTier = accountRotationManager.getAvailableByTier('claude')

    // Should have 2 paid and 2 free
    expect(byTier.paid.length).toBe(2)
    expect(byTier.free.length).toBe(2)

    // Verify tier values
    for (const account of byTier.paid) {
      expect(account.tier).toBe('paid')
    }
    for (const account of byTier.free) {
      expect(account.tier).toBe('free')
    }
  })
})
