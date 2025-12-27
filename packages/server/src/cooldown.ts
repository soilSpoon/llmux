interface CooldownState {
  resetAt: number
  backoffLevel: number
}

export class CooldownManager {
  private cooldowns = new Map<string, CooldownState>()
  private readonly BACKOFF_BASE = 30_000 // 30 seconds
  private readonly BACKOFF_MAX = 15 * 60_000 // 15 minutes

  /**
   * Mark a model as rate-limited.
   * @param key Unique identifier for the model (e.g., "provider:model")
   * @param retryAfterMs Optional specific cooldown time from headers
   */
  markRateLimited(key: string, retryAfterMs?: number): number {
    const state = this.cooldowns.get(key) || { resetAt: 0, backoffLevel: 0 }

    let duration: number

    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      duration = retryAfterMs
    } else {
      // Exponential backoff: base * 2^level
      duration = Math.min(this.BACKOFF_BASE * 2 ** state.backoffLevel, this.BACKOFF_MAX)
      state.backoffLevel++
    }

    // Add slight positive jitter (0-10%) to prevent thundering herd
    // and ensure we don't wait less than requested
    const jitter = duration * 0.1 * Math.random()
    duration += jitter

    state.resetAt = Date.now() + duration
    this.cooldowns.set(key, state)

    return duration
  }

  isAvailable(key: string): boolean {
    const state = this.cooldowns.get(key)
    if (!state) return true

    if (Date.now() > state.resetAt) {
      // Cooldown expired, but we keep the entry with backoffLevel
      // until a successful request clears it (handled by consumer) or we lazily clean it up
      // For now, simple availability check:
      return true
    }

    return false
  }

  getResetTime(key: string): number {
    return this.cooldowns.get(key)?.resetAt || 0
  }

  /**
   * Reset the backoff level for a model (e.g. after a successful request)
   */
  reset(key: string): void {
    this.cooldowns.delete(key)
  }
}
