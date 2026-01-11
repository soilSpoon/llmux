import { type Credential, isOAuthCredential, type OAuthCredential, TokenRefresh } from '@llmux/auth'
import { AccountRotationWithTierManager } from './account-rotation-with-tier'
import { getModelFamily } from './family-rate-limiting'

interface AccountState {
  index: number
  rateLimitedUntil: number
}

export class AccountRotationManager {
  // Key (provider:model) -> List of Account States
  private states: Map<string, AccountState[]> = new Map()

  private getKey(provider: string, model: string): string {
    return `${provider}:${model}`
  }

  private getStates(provider: string, model: string): AccountState[] {
    const key = this.getKey(provider, model)
    if (!this.states.has(key)) {
      this.states.set(key, [])
    }
    const states = this.states.get(key)
    return states ?? []
  }

  /**
   * Get the next available account index for the provider/model.
   * Uses AccountRotationWithTierManager to prioritize paid accounts.
   */
  getNextAvailable(provider: string, model: string, credentials: Credential[]): number {
    if (!credentials || credentials.length === 0) return 0
    if (credentials.length === 1) return 0

    // Initialize Tier Manager with credentials
    const tierManager = new AccountRotationWithTierManager(credentials)

    // Determine Model Family
    const family = getModelFamily(model, provider)
    if (family === 'unknown') {
      // Fallback to simple round-robin or first available if family unknown
      return this.getSimpleNextAvailable(provider, model, credentials)
    }

    // Sync rate limits from local states to Tier Manager
    const states = this.getStates(provider, model)
    const now = Date.now()

    states.forEach((state) => {
      if (state.rateLimitedUntil > now) {
        tierManager.markRateLimited(state.index, family)
      }
    })

    // Get next account via Tier Manager (prioritizes paid)
    const nextAccount = tierManager.getNextAccount(family)

    if (nextAccount) {
      return nextAccount.index
    }

    // If no account returned by Tier Manager (all limited for this family),
    // fallback to finding the one with earliest expiry
    return this.getEarliestExpiryIndex(provider, model, credentials)
  }

  private getSimpleNextAvailable(
    provider: string,
    model: string,
    credentials: Credential[]
  ): number {
    const states = this.getStates(provider, model)
    const now = Date.now()

    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      if (!state || state.rateLimitedUntil <= now) {
        return i
      }
    }
    return this.getEarliestExpiryIndex(provider, model, credentials)
  }

  private getEarliestExpiryIndex(
    provider: string,
    model: string,
    credentials: Credential[]
  ): number {
    const states = this.getStates(provider, model)
    let bestIndex = 0
    let minRateLimitedUntil = Infinity

    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      if (!state) return i

      if (state.rateLimitedUntil < minRateLimitedUntil) {
        minRateLimitedUntil = state.rateLimitedUntil
        bestIndex = i
      }
    }
    return bestIndex
  }

  /**
   * Mark an account as rate-limited.
   */
  markRateLimited(provider: string, model: string, index: number, durationMs: number): void {
    const states = this.getStates(provider, model)
    const existing = states.find((s) => s.index === index)
    const rateLimitedUntil = Date.now() + durationMs

    if (existing) {
      existing.rateLimitedUntil = rateLimitedUntil
    } else {
      states.push({ index, rateLimitedUntil })
    }
  }

  /**
   * Check if all accounts for a provider are rate-limited.
   */
  areAllRateLimited(provider: string, model: string, credentials: Credential[]): boolean {
    if (!credentials || credentials.length === 0) return false

    const states = this.getStates(provider, model)
    const now = Date.now()

    let rateLimitedCount = 0
    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      if (state && state.rateLimitedUntil > now) {
        rateLimitedCount++
      }
    }

    return rateLimitedCount >= credentials.length
  }

  /**
   * Get the minimum wait time if all accounts are rate limited.
   * Returns 0 if at least one account is available.
   */
  getMinWaitTime(provider: string, model: string, credentials: Credential[]): number {
    if (!this.areAllRateLimited(provider, model, credentials)) return 0

    const states = this.getStates(provider, model)
    const now = Date.now()
    let minWait = Infinity

    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      if (state && state.rateLimitedUntil > now) {
        const wait = state.rateLimitedUntil - now
        if (wait < minWait) minWait = wait
      }
    }

    return minWait === Infinity ? 0 : minWait
  }
  /**
   * Get a fresh credential and account info for a provider.
   * If currentIndex is provided and valid, try to use the next available account starting from currentIndex + 1.
   * Otherwise, use getNextAvailable() which finds the first non-rate-limited account.
   */
  async getCredential(
    provider: string,
    model: string,
    currentIndex: number
  ): Promise<{ credentials: Credential[]; accountId?: string; accountIndex: number } | null> {
    const freshCredentials = await TokenRefresh.ensureFresh(provider)
    if (!freshCredentials || freshCredentials.length === 0) return null

    let accountIndex: number
    const states = this.getStates(provider, model)
    const now = Date.now()

    // Determine Model Family for Tier-based logic
    const family = getModelFamily(model, provider)

    // Use Tier Manager if possible
    if (family !== 'unknown') {
      const tierManager = new AccountRotationWithTierManager(freshCredentials)

      // Sync limits
      states.forEach((state) => {
        if (state.rateLimitedUntil > now) {
          tierManager.markRateLimited(state.index, family)
        }
      })

      // If we have a current index, we want to find the next *preferred* account.
      // The original logic tried simply incrementing index.
      // Tier logic is smarter: it prioritizes paid.
      // So asking for "next account" given "current index" from TierManager is ideal.

      const nextAccount = tierManager.getNextAccount(
        family,
        currentIndex >= 0 ? currentIndex : undefined
      )

      if (nextAccount) {
        accountIndex = nextAccount.index
      } else {
        // Fallback if Tier Manager finds nothing available (all limited)
        // We might want to just rotate or pick earliest expiry
        accountIndex = this.getEarliestExpiryIndex(provider, model, freshCredentials)
      }
    } else {
      // Legacy simple rotation logic for unknown families
      if (currentIndex >= 0 && currentIndex < freshCredentials.length) {
        accountIndex = -1
        // Search for next available account after currentIndex
        for (let i = currentIndex + 1; i < freshCredentials.length; i++) {
          const state = states.find((s) => s.index === i)
          if (!state || state.rateLimitedUntil <= now) {
            accountIndex = i
            break
          }
        }
        // If no available after currentIndex, wrap around
        if (accountIndex === -1) {
          for (let i = 0; i <= currentIndex; i++) {
            const state = states.find((s) => s.index === i)
            if (!state || state.rateLimitedUntil <= now) {
              accountIndex = i
              break
            }
          }
        }
        // If still not found, fallback to getNextAvailable
        if (accountIndex === -1) {
          accountIndex = this.getSimpleNextAvailable(provider, model, freshCredentials)
        }
      } else {
        accountIndex = this.getSimpleNextAvailable(provider, model, freshCredentials)
      }
    }

    const credential = freshCredentials[accountIndex] as Credential

    return {
      credentials: freshCredentials,
      accountId: isOAuthCredential(credential)
        ? (credential as OAuthCredential).accountId
        : undefined,
      accountIndex,
    }
  }

  /**
   * Check if there's a next account to try.
   */
  hasNext(_provider: string, _model: string, _currentIndex: number): boolean {
    return true
  }
}

// Singleton instance
export const accountRotationManager = new AccountRotationManager()
