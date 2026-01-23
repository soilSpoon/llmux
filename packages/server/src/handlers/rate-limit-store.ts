import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProviderName } from '@llmux/core'
import type { ModelFamily } from './account-rotation-with-tier'

export interface RateLimit {
  expiresAt: number | null // null means indefinite/until manual reset
  reason?: string
  backoffLevel?: number
}

function getRateLimitsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~'
  return join(home, '.llmux', 'rate-limits.json')
}

interface StoredRateLimits {
  limits: Record<string, RateLimit>
}

export function getModelFamily(model: string, provider: ProviderName | string): ModelFamily {
  const lowerModel = model.toLowerCase()

  if (provider === 'anthropic' || lowerModel.includes('claude')) {
    return 'claude'
  }

  if (lowerModel.includes('flash')) {
    return 'gemini-flash'
  }

  if (lowerModel.includes('pro') || lowerModel.includes('thinking')) {
    return 'gemini-pro'
  }

  if (provider === 'antigravity' || lowerModel.includes('gemini')) {
    return 'gemini-flash'
  }

  return 'unknown' as ModelFamily
}

export function isClaudeWeeklyLimit(model: string): boolean {
  return model.toLowerCase().includes('claude')
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

  markGlobalCooldown(key: string, retryAfterMs?: number): number
  isGlobalCooldown(key: string): boolean
  getGlobalResetTime(key: string): number
  resetGlobalCooldown(key: string): void
  getAllGlobal(): Array<{ key: string; resetAt: number; backoffLevel: number }>

  clear(): void
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, RateLimit> = new Map()
  private saveTimeout: Timer | null = null

  private readonly BACKOFF_BASE = 30_000
  private readonly BACKOFF_MAX = 15 * 60_000

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      const path = getRateLimitsPath()
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8')
        const data = JSON.parse(content) as StoredRateLimits

        if (data.limits) {
          for (const [key, limit] of Object.entries(data.limits)) {
            this.store.set(key, limit)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load rate limits:', error)
    }
  }

  private save(): void {
    if (this.saveTimeout) return

    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null
      try {
        const path = getRateLimitsPath()
        const dir = dirname(path)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }

        const data: StoredRateLimits = {
          limits: Object.fromEntries(this.store),
        }

        writeFileSync(path, JSON.stringify(data, null, 2))
      } catch (error) {
        console.error('Failed to save rate limits:', error)
      }
    }, 1000) as unknown as Timer
  }

  clear(): void {
    this.store.clear()
    this.save()
  }

  private getAccountKey(provider: string, accountId: string, family: string): string {
    return `${provider}:${family}:${accountId}`
  }

  private getGlobalKey(key: string): string {
    return `global:${key}`
  }

  markLimit(provider: string, accountId: string, family: string, limit: RateLimit): void {
    const key = this.getAccountKey(provider, accountId, family)
    this.store.set(key, limit)
    this.save()
  }

  getLimit(provider: string, accountId: string, family: string): RateLimit | null {
    const key = this.getAccountKey(provider, accountId, family)
    const limit = this.store.get(key)
    if (!limit) return null

    if (limit.expiresAt && limit.expiresAt < Date.now()) {
      this.store.delete(key)
      this.save()
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
    this.save()
    return result
  }

  clearLimit(provider: string, accountId: string, family: string): void {
    const key = this.getAccountKey(provider, accountId, family)
    this.store.delete(key)
    this.save()
  }

  markGlobalCooldown(key: string, retryAfterMs?: number): number {
    const globalKey = this.getGlobalKey(key)
    const state = this.store.get(globalKey) || { expiresAt: 0, backoffLevel: 0 }

    state.backoffLevel = state.backoffLevel || 0

    let duration: number

    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      duration = retryAfterMs
    } else {
      duration = Math.min(this.BACKOFF_BASE * 2 ** state.backoffLevel, this.BACKOFF_MAX)
      state.backoffLevel++
    }

    const jitter = duration * 0.1 * Math.random()
    duration += jitter

    state.expiresAt = Date.now() + duration

    this.store.set(globalKey, state)
    this.save()

    return duration
  }

  isGlobalCooldown(key: string): boolean {
    const globalKey = this.getGlobalKey(key)
    const state = this.store.get(globalKey)
    if (!state) return false

    if (state.expiresAt && Date.now() > state.expiresAt) {
      return false
    }

    return true
  }

  getGlobalResetTime(key: string): number {
    const globalKey = this.getGlobalKey(key)
    return this.store.get(globalKey)?.expiresAt || 0
  }

  resetGlobalCooldown(key: string): void {
    const globalKey = this.getGlobalKey(key)
    this.store.delete(globalKey)
    this.save()
  }

  getAllGlobal(): Array<{ key: string; resetAt: number; backoffLevel: number }> {
    const result: Array<{ key: string; resetAt: number; backoffLevel: number }> = []
    const prefix = 'global:'

    for (const [storeKey, state] of this.store.entries()) {
      if (storeKey.startsWith(prefix)) {
        const key = storeKey.slice(prefix.length)
        if (state.expiresAt && state.expiresAt > 0) {
          result.push({
            key,
            resetAt: state.expiresAt,
            backoffLevel: state.backoffLevel || 0,
          })
        }
      }
    }
    return result
  }
}

export const rateLimitStore = new InMemoryRateLimitStore()
