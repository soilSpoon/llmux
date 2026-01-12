import { type Credential, isOAuthCredential, type OAuthCredential } from '@llmux/auth'

export type AccountTier = 'free' | 'paid'
export type ModelFamily = 'gemini-flash' | 'gemini-pro' | 'claude'

interface Account {
  index: number
  tier: AccountTier
  rateLimitedFamilies: Set<ModelFamily>
}

export class AccountRotationWithTierManager {
  private accounts: Account[]

  constructor(credentials: Credential[]) {
    this.accounts = this.extractAccountsWithTiers(credentials)
  }

  /**
   * Extract tier information from credentials
   * OAuth credentials may have metadata.tier field
   * API key credentials default to 'free'
   */
  private extractAccountsWithTiers(credentials: Credential[]): Account[] {
    return credentials.map((cred, index) => {
      let tier: AccountTier = 'free' // default to free

      if (isOAuthCredential(cred)) {
        const oauthCred = cred as OAuthCredential
        const tierFromMetadata = (oauthCred.metadata?.tier as AccountTier) || 'free'
        tier = tierFromMetadata
      }

      return {
        index,
        tier,
        rateLimitedFamilies: new Set<ModelFamily>(),
      }
    })
  }

  /**
   * Get next available account, preferring paid over free
   * Returns undefined if no accounts are available
   */
  getNextAccount(
    family: ModelFamily,
    currentIndex?: number,
    rotate: boolean = true,
    blockedIndices?: Set<number>
  ): Account | undefined {
    // If not rotating and we have a valid current index, check if it's available
    if (
      !rotate &&
      currentIndex !== undefined &&
      currentIndex >= 0 &&
      currentIndex < this.accounts.length
    ) {
      const currentAccount = this.accounts[currentIndex]
      if (
        currentAccount &&
        !blockedIndices?.has(currentIndex) &&
        !currentAccount.rateLimitedFamilies.has(family)
      ) {
        return currentAccount
      }
    }

    const availableAccounts = this.accounts.filter(
      (acc) => !blockedIndices?.has(acc.index) && !acc.rateLimitedFamilies.has(family)
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

  /**
   * Mark a family as rate-limited for an account
   */
  markRateLimited(accountIndex: number, family: ModelFamily): void {
    const account = this.accounts.find((acc) => acc.index === accountIndex)
    if (account) {
      account.rateLimitedFamilies.add(family)
    }
  }

  /**
   * Reset (unmark) a family for an account
   */
  resetFamily(accountIndex: number, family: ModelFamily): void {
    const account = this.accounts.find((acc) => acc.index === accountIndex)
    if (account) {
      account.rateLimitedFamilies.delete(family)
    }
  }

  /**
   * Get all available accounts for a family
   */
  getAvailableAccounts(family: ModelFamily): Account[] {
    return this.accounts.filter((acc) => !acc.rateLimitedFamilies.has(family))
  }

  /**
   * Get the tier of an account by index
   */
  getAccountTier(index: number): AccountTier | undefined {
    return this.accounts.find((acc) => acc.index === index)?.tier
  }

  /**
   * Get all accounts
   */
  getAllAccounts(): Account[] {
    return this.accounts
  }

  /**
   * Get available accounts for a family, grouped by tier
   */
  getAvailableByTier(family: ModelFamily): {
    paid: Account[]
    free: Account[]
  } {
    const available = this.getAvailableAccounts(family)
    return {
      paid: available.filter((acc) => acc.tier === 'paid'),
      free: available.filter((acc) => acc.tier === 'free'),
    }
  }
}
