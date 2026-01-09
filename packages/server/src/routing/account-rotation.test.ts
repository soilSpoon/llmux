import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * Tests for account rotation with tier and rate limit awareness
 * Ensures paid accounts are prioritized, falls back to free when needed
 */

type AccountTier = 'free' | 'paid'
type ModelFamily = 'gemini-flash' | 'gemini-pro' | 'claude'

interface Account {
  index: number
  tier: AccountTier
  rateLimitedFamilies: Set<ModelFamily>
}

class AccountRotationManager {
  private accounts: Account[]

  constructor(accounts: Account[]) {
    this.accounts = accounts
  }

  /**
   * Get next available account, preferring paid over free
   */
  getNextAccount(family: ModelFamily, currentIndex?: number): Account | undefined {
    const availableAccounts = this.accounts.filter(
      (acc) => !acc.rateLimitedFamilies.has(family)
    )

    if (availableAccounts.length === 0) return undefined

    // Prefer paid accounts
    const paidAccounts = availableAccounts.filter((acc) => acc.tier === 'paid')
    if (paidAccounts.length > 0) {
      // If we have a current index, try to get next paid account
      if (currentIndex !== undefined) {
        const nextPaid = paidAccounts.find((acc) => acc.index > currentIndex)
        if (nextPaid) return nextPaid
      }
      // Cycle back to first paid account
      return paidAccounts[0]
    }

    // Fall back to free accounts
    if (currentIndex !== undefined) {
      const nextFree = availableAccounts.find((acc) => acc.index > currentIndex)
      if (nextFree) return nextFree
    }
    return availableAccounts[0]
  }

  markRateLimited(accountIndex: number, family: ModelFamily): void {
    const account = this.accounts.find((acc) => acc.index === accountIndex)
    if (account) {
      account.rateLimitedFamilies.add(family)
    }
  }

  resetFamily(accountIndex: number, family: ModelFamily): void {
    const account = this.accounts.find((acc) => acc.index === accountIndex)
    if (account) {
      account.rateLimitedFamilies.delete(family)
    }
  }

  getAvailableAccounts(family: ModelFamily): Account[] {
    return this.accounts.filter((acc) => !acc.rateLimitedFamilies.has(family))
  }
}

describe('account rotation with tier prioritization', () => {
  let manager: AccountRotationManager

  beforeEach(() => {
    const accounts: Account[] = [
      { index: 0, tier: 'paid', rateLimitedFamilies: new Set() },
      { index: 1, tier: 'free', rateLimitedFamilies: new Set() },
      { index: 2, tier: 'paid', rateLimitedFamilies: new Set() },
      { index: 3, tier: 'free', rateLimitedFamilies: new Set() },
    ]
    manager = new AccountRotationManager(accounts)
  })

  it('should prefer paid accounts over free accounts', () => {
    const account = manager.getNextAccount('gemini-flash')
    expect(account?.tier).toBe('paid')
  })

  it('should fall back to free accounts when all paid are rate-limited', () => {
    manager.markRateLimited(0, 'gemini-flash')
    manager.markRateLimited(2, 'gemini-flash')

    const account = manager.getNextAccount('gemini-flash')
    expect(account?.tier).toBe('free')
    expect(account?.index).toBeOneOf([1, 3])
  })

  it('should return undefined when all accounts are rate-limited', () => {
    manager.markRateLimited(0, 'gemini-flash')
    manager.markRateLimited(1, 'gemini-flash')
    manager.markRateLimited(2, 'gemini-flash')
    manager.markRateLimited(3, 'gemini-flash')

    const account = manager.getNextAccount('gemini-flash')
    expect(account).toBeUndefined()
  })

  it('should rotate to next account of same tier', () => {
    const first = manager.getNextAccount('gemini-flash')
    expect(first?.index).toBe(0)

    const second = manager.getNextAccount('gemini-flash', first?.index)
    expect(second?.index).toBe(2) // Next paid account
  })

  it('should track different families independently', () => {
    manager.markRateLimited(0, 'gemini-flash')

    const forFlash = manager.getNextAccount('gemini-flash')
    const forPro = manager.getNextAccount('gemini-pro')

    expect(forFlash?.index).toBe(2) // Second paid account
    expect(forPro?.index).toBe(0) // First paid account (not limited for gemini-pro)
  })

  it('should reset family availability after successful use', () => {
    manager.markRateLimited(0, 'claude')
    expect(manager.getNextAccount('claude')?.index).toBe(2)

    manager.resetFamily(0, 'claude')
    expect(manager.getNextAccount('claude')?.index).toBe(0) // Back to first paid
  })

  it('should load-balance within paid tier after reset', () => {
    // All start available, should get first paid
    let account = manager.getNextAccount('gemini-flash')
    expect(account?.index).toBe(0)

    // Mark first as limited
    manager.markRateLimited(0, 'gemini-flash')

    // Should get second paid account
    account = manager.getNextAccount('gemini-flash')
    expect(account?.index).toBe(2)

    // Reset first
    manager.resetFamily(0, 'gemini-flash')

    // Next call should cycle back to first
    account = manager.getNextAccount('gemini-flash', 2)
    expect(account?.index).toBe(0)
  })

  it('should list available accounts for a family', () => {
    manager.markRateLimited(0, 'claude')
    manager.markRateLimited(1, 'claude')

    const available = manager.getAvailableAccounts('claude')
    expect(available.map((a) => a.index)).toEqual([2, 3])
  })
})
