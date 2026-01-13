import type { ModelFamily } from './account-rotation-with-tier'

export type LimitType = 'soft' | 'hard'

export interface RateLimit {
  type: LimitType
  expiresAt: number | null // null means indefinite/until manual reset
  reason?: string
}

export interface RateLimitStore {
  markLimit(
    provider: string,
    accountId: string,
    family: ModelFamily | string,
    limit: RateLimit
  ): void

  getLimit(provider: string, accountId: string, family: ModelFamily | string): RateLimit | null

  getLimits(provider: string, family: ModelFamily | string): Map<string, RateLimit>

  clearLimit(provider: string, accountId: string, family: ModelFamily | string): void
}

export class InMemoryRateLimitStore implements RateLimitStore {
  // Key: provider:family:accountId
  private store: Map<string, RateLimit> = new Map()

  private getKey(provider: string, accountId: string, family: string): string {
    return `${provider}:${family}:${accountId}`
  }

  markLimit(provider: string, accountId: string, family: string, limit: RateLimit): void {
    const key = this.getKey(provider, accountId, family)
    this.store.set(key, limit)
  }

  getLimit(provider: string, accountId: string, family: string): RateLimit | null {
    const key = this.getKey(provider, accountId, family)
    const limit = this.store.get(key)
    if (!limit) return null

    if (limit.expiresAt && limit.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }

    return limit
  }

  getLimits(provider: string, family: string): Map<string, RateLimit> {
    const result = new Map<string, RateLimit>()
    const now = Date.now()
    const prefix = `${provider}:${family}:`

    for (const [key, limit] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const accountId = key.slice(prefix.length)
        if (limit.expiresAt && limit.expiresAt < now) {
          this.store.delete(key)
        } else {
          result.set(accountId, limit)
        }
      }
    }
    return result
  }

  clearLimit(provider: string, accountId: string, family: string): void {
    const key = this.getKey(provider, accountId, family)
    this.store.delete(key)
  }
}

export const rateLimitStore = new InMemoryRateLimitStore()
