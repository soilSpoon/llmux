import type { Credential } from '@llmux/auth'

interface AccountState {
  index: number
  rateLimitedUntil: number
}

export class AccountRotationManager {
  // Provider -> List of Account States
  private states: Map<string, AccountState[]> = new Map()

  private getStates(provider: string): AccountState[] {
    if (!this.states.has(provider)) {
      this.states.set(provider, [])
    }
    const states = this.states.get(provider)
    return states ?? []
  }

  /**
   * Get the next available account index for the provider.
   * If all accounts are rate-limited, returns the one with the earliest reset time
   * (or currently available one if any).
   */
  getNextAvailable(provider: string, credentials: Credential[]): number {
    if (!credentials || credentials.length === 0) return 0
    if (credentials.length === 1) return 0

    const states = this.getStates(provider)
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
  markRateLimited(provider: string, index: number, durationMs: number): void {
    const states = this.getStates(provider)
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
  areAllRateLimited(provider: string, credentials: Credential[]): boolean {
    if (!credentials || credentials.length === 0) return false

    const states = this.getStates(provider)
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
  getMinWaitTime(provider: string, credentials: Credential[]): number {
    if (!this.areAllRateLimited(provider, credentials)) return 0

    const states = this.getStates(provider)
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
}

// Singleton instance
export const accountRotationManager = new AccountRotationManager()
