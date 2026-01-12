import { createHash } from 'node:crypto'
import { type Credential, isOAuthCredential, type OAuthCredential, TokenRefresh } from '@llmux/auth'
import { AccountRotationWithTierManager, type ModelFamily } from './account-rotation-with-tier'
import { getModelFamily } from './family-rate-limiting'
import { type LimitType, rateLimitStore } from './rate-limit-store'

export class AccountRotationManager {
  private getAccountId(credential: Credential): string {
    if (isOAuthCredential(credential)) {
      return (credential as OAuthCredential).accountId || 'unknown-oauth'
    }
    // For API keys or other types, use a hash of the credential itself as a stable ID
    const str = JSON.stringify(credential)
    return createHash('sha256').update(str).digest('hex').slice(0, 16)
  }

  /**
   * Get the next available account index for the provider/model.
   * This is a simplified version often used for pre-checks.
   */
  getNextAvailable(provider: string, model: string, credentials: Credential[]): number {
    if (!credentials || credentials.length === 0) return 0
    if (credentials.length === 1) return 0

    const family = getModelFamily(model, provider)

    // Check each credential against the store
    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i]
      if (!cred) continue
      const accountId = this.getAccountId(cred)
      const limit = rateLimitStore.getLimit(provider, accountId, family)
      if (!limit) {
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
    const family = getModelFamily(model, provider)
    let bestIndex = 0
    let minExpiresAt = Infinity

    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i]
      if (!cred) continue
      const accountId = this.getAccountId(cred)
      const limit = rateLimitStore.getLimit(provider, accountId, family)

      if (!limit) return i

      if (limit.expiresAt !== null && limit.expiresAt < minExpiresAt) {
        minExpiresAt = limit.expiresAt
        bestIndex = i
      }
    }
    return bestIndex
  }

  /**
   * Mark an account as rate-limited.
   */
  markRateLimited(
    provider: string,
    model: string,
    index: number,
    durationMs: number,
    type: LimitType = 'soft',
    reason?: string
  ): void {
    const family = getModelFamily(model, provider)
    // We need to fetch credentials to get the accountId, but this is usually called
    // in context where we already have the credential or can get it from index.
    // For now, we'll assume we can get it from TokenRefresh or caller should provide accountId.
    // To minimize churn, let's keep index for now but look up ID.
    TokenRefresh.ensureFresh(provider).then((credentials) => {
      if (credentials?.[index]) {
        const accountId = this.getAccountId(credentials[index])
        rateLimitStore.markLimit(provider, accountId, family, {
          type,
          expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
          reason,
        })
      }
    })
  }

  /**
   * Check if all accounts for a provider are rate-limited.
   */
  areAllRateLimited(provider: string, model: string, credentials: Credential[]): boolean {
    if (!credentials || credentials.length === 0) return false

    const family = getModelFamily(model, provider)
    let rateLimitedCount = 0
    for (const cred of credentials) {
      const accountId = this.getAccountId(cred)
      if (rateLimitStore.getLimit(provider, accountId, family)) {
        rateLimitedCount++
      }
    }

    return rateLimitedCount >= credentials.length
  }

  /**
   * Get the minimum wait time if all accounts are rate limited.
   */
  getMinWaitTime(provider: string, model: string, credentials: Credential[]): number {
    const family = getModelFamily(model, provider)
    const now = Date.now()
    let minWait = Infinity

    for (const cred of credentials) {
      const accountId = this.getAccountId(cred)
      const limit = rateLimitStore.getLimit(provider, accountId, family)
      if (!limit) return 0

      if (limit.expiresAt && limit.expiresAt > now) {
        const wait = limit.expiresAt - now
        if (wait < minWait) minWait = wait
      }
    }

    return minWait === Infinity ? 0 : minWait
  }

  /**
   * Get a fresh credential and account info for a provider.
   */
  async getCredential(
    provider: string,
    model: string,
    currentIndex: number,
    rotate: boolean = true
  ): Promise<{ credentials: Credential[]; accountId?: string; accountIndex: number } | null> {
    const freshCredentials = await TokenRefresh.ensureFresh(provider)
    if (!freshCredentials || freshCredentials.length === 0) return null

    const family = getModelFamily(model, provider)
    const blockedIndices = new Set<number>()

    for (let i = 0; i < freshCredentials.length; i++) {
      const cred = freshCredentials[i]
      if (!cred) continue
      const accountId = this.getAccountId(cred)
      if (rateLimitStore.getLimit(provider, accountId, family)) {
        blockedIndices.add(i)
      }
    }

    const tierManager = new AccountRotationWithTierManager(freshCredentials)
    // We'll modify TierManager to accept blockedIndices or use its existing marking but from our store
    for (const idx of blockedIndices) {
      tierManager.markRateLimited(idx, family as ModelFamily)
    }

    const nextAccount = tierManager.getNextAccount(
      family as ModelFamily,
      currentIndex >= 0 ? currentIndex : undefined,
      rotate,
      blockedIndices
    )

    let accountIndex: number
    if (nextAccount) {
      accountIndex = nextAccount.index
    } else {
      accountIndex = this.getEarliestExpiryIndex(provider, model, freshCredentials)
    }

    const credential = freshCredentials[accountIndex]
    if (!credential) {
      return null
    }

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
  hasNext(
    provider: string,
    model: string,
    currentIndex: number,
    credentials?: Credential[]
  ): boolean {
    if (!credentials) return true // Best effort if not provided

    const family = getModelFamily(model, provider)
    for (let i = 0; i < credentials.length; i++) {
      if (i === currentIndex) continue
      const cred = credentials[i]
      if (!cred) continue
      const accountId = this.getAccountId(cred)
      if (!rateLimitStore.getLimit(provider, accountId, family)) {
        return true
      }
    }
    return false
  }
}

export const accountRotationManager = new AccountRotationManager()
