import { type Credential, isOAuthCredential, type OAuthCredential, TokenRefresh } from '@llmux/auth'

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
   * If all accounts are rate-limited, returns the one with the earliest reset time
   * (or currently available one if any).
   */
  getNextAvailable(provider: string, model: string, credentials: Credential[]): number {
    if (!credentials || credentials.length === 0) return 0
    if (credentials.length === 1) return 0

    const states = this.getStates(provider, model)
    const now = Date.now()

    // 1. Find first available account (not rate limited)
    // We prefer accounts that are not in the states list (meaning they haven't been rate limited yet)
    // or accounts whose rateLimitedUntil is in the past.

    // Check for any account that is NOT in our rate-limit tracking or has expired rate limit
    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      if (!state || state.rateLimitedUntil <= now) {
        return i
      }
    }

    // 2. If all are rate limited, find the one that expires soonest
    // We want to return an index even if all are limited, so the caller can wait.
    // However, the caller might want to know if all are limited.
    // Here we just return the "best" candidate.

    let bestIndex = 0
    let minRateLimitedUntil = Infinity

    for (let i = 0; i < credentials.length; i++) {
      const state = states.find((s) => s.index === i)
      // If state is missing, it means available (already handled above, but just in case)
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

    // If we have fewer states than credentials, it means some credentials haven't been rate limited
    // However, we only track rate-limited accounts.
    // Simply checking count is safer: track how many are valid.

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

    // If we have a currentIndex, try to find the next available account starting after currentIndex
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
        accountIndex = this.getNextAvailable(provider, model, freshCredentials)
      }
    } else {
      accountIndex = this.getNextAvailable(provider, model, freshCredentials)
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
