import { describe, it, expect, beforeEach } from 'bun:test'
import { Router } from './router'
import type { RoutingConfig } from '../config'
import { AccountRotationWithTierManager } from '../handlers/account-rotation-with-tier'
import type { Credential } from '@llmux/auth'

/**
 * Integration tests for Router with AccountRotationWithTierManager
 * Verifies that account rotation prefers paid accounts over free
 */

describe('Router + AccountRotationWithTierManager integration', () => {
  let _router: Router
  let tierManager: AccountRotationWithTierManager

  beforeEach(() => {
    const config: RoutingConfig = {
      fallbackOrder: ['antigravity', 'openai'],
      rotateOn429: true,
      maxRetryAttempts: 20,
    }
    _router = new Router(config)
    expect(_router).toBeDefined()

    // Create mock credentials with tier info
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
      {
        type: 'oauth',
        accessToken: 'token-free-2',
        refreshToken: 'refresh-free-2',
        expiresAt: Date.now() + 3600000,
        metadata: { tier: 'free' },
      },
    ]

    tierManager = new AccountRotationWithTierManager(credentials)
  })

  it('should prioritize paid accounts over free when rotating', () => {
    // Get first available account (should prefer paid)
    const paidAccount = tierManager.getNextAccount('gemini-flash')

    expect(paidAccount).toBeDefined()
    expect(paidAccount?.tier).toBe('paid')
  })

  it('should fall back to free accounts when no paid accounts available', () => {
    // Mark all paid accounts as rate-limited
    tierManager.markRateLimited(1, 'gemini-flash')

    const nextAccount = tierManager.getNextAccount('gemini-flash')

    expect(nextAccount).toBeDefined()
    expect(nextAccount?.tier).toBe('free')
  })

  it('should respect rate limit status across families', () => {
    // Mark paid account as rate-limited only for gemini-flash
    tierManager.markRateLimited(1, 'gemini-flash')

    // Get available accounts for gemini-flash
    const flashAvailable = tierManager.getAvailableAccounts('gemini-flash')

    // Should only have free accounts since paid is limited
    const paidInFlash = flashAvailable.filter((a) => a.tier === 'paid')
    expect(paidInFlash.length).toBe(0)

    // Get available accounts for claude (should still have paid)
    const claudeAvailable = tierManager.getAvailableAccounts('claude')
    const paidInClaude = claudeAvailable.filter((a) => a.tier === 'paid')
    expect(paidInClaude.length).toBeGreaterThan(0)
  })

  it('should retrieve tier information for accounts', () => {
    const tier0 = tierManager.getAccountTier(0)
    const tier1 = tierManager.getAccountTier(1)
    const tier2 = tierManager.getAccountTier(2)

    expect(tier0).toBe('free')
    expect(tier1).toBe('paid')
    expect(tier2).toBe('free')
  })

  it('should group available accounts by tier', () => {
    const byTier = tierManager.getAvailableByTier('gemini-flash')

    expect(byTier.paid.length).toBeGreaterThan(0)
    expect(byTier.free.length).toBeGreaterThan(0)

    // Verify tier assignment
    for (const account of byTier.paid) {
      expect(account.tier).toBe('paid')
    }
    for (const account of byTier.free) {
      expect(account.tier).toBe('free')
    }
  })

  it('should handle next account selection with current index', () => {
    // Start from free account (index 0), should try to get next paid or free
    const nextFromFree = tierManager.getNextAccount('gemini-flash', 0)

    expect(nextFromFree).toBeDefined()
    // Should prefer paid account at index 1 over free at index 2
    expect(nextFromFree?.index).toBe(1)
  })

  it('should wrap around when reaching end of accounts', () => {
    // Start from last index (2)
    const nextFromLast = tierManager.getNextAccount('gemini-flash', 2)

    expect(nextFromLast).toBeDefined()
    // Should wrap back to beginning
    expect(nextFromLast?.index).toBeLessThan(3)
  })

  it('should return undefined when all accounts are rate-limited', () => {
    // Mark all accounts as rate-limited for a family
    tierManager.markRateLimited(0, 'gemini-flash')
    tierManager.markRateLimited(1, 'gemini-flash')
    tierManager.markRateLimited(2, 'gemini-flash')

    const nextAccount = tierManager.getNextAccount('gemini-flash')

    expect(nextAccount).toBeUndefined()
  })

  it('should reset family rate limit for specific account', () => {
    tierManager.markRateLimited(1, 'gemini-flash')

    expect(tierManager.getAvailableAccounts('gemini-flash')).not.toContainEqual(
      expect.objectContaining({ index: 1 })
    )

    tierManager.resetFamily(1, 'gemini-flash')

    const available = tierManager.getAvailableAccounts('gemini-flash')
    const account1 = available.find((a) => a.index === 1)
    expect(account1).toBeDefined()
  })
})
