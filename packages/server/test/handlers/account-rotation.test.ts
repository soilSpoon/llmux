import { describe, expect, it, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import { accountRotationManager as manager } from '../../src/handlers/account-rotation'
import { rateLimitStore } from '../../src/handlers/rate-limit-store'
import { TokenRefresh } from '@llmux/auth'
import type { Credential } from '@llmux/auth'

describe('AccountRotationManager', () => {
  let mockCredentials: Credential[]

  beforeEach(() => {
    // Reset store
    rateLimitStore.clear()

    mockCredentials = [
      {
        type: 'oauth',
        accountId: 'acc-1',
        accessToken: 'token-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3600000,
        provider: 'provider-a',
        email: 'test1@example.com'
      },
      {
        type: 'oauth',
        accountId: 'acc-2',
        accessToken: 'token-2',
        refreshToken: 'refresh-2',
        expiresAt: Date.now() + 3600000,
        provider: 'provider-a',
        email: 'test2@example.com'
      }
    ] as any[]
    
    spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue(mockCredentials)
  })

  afterEach(() => {
    mock.restore()
  })

  it('getNextAvailable returns 0 when no limits exist', () => {
    const idx = manager.getNextAvailable('provider-a', 'gemini-pro', mockCredentials)
    expect(idx).toBe(0)
  })

  it('skips rate limited accounts', () => {
    // Limit the first account
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', {
      expiresAt: Date.now() + 1000
    })

    const idx = manager.getNextAvailable('provider-a', 'gemini-pro', mockCredentials)
    expect(idx).toBe(1)
  })

  it('returns index with earliest expiry if all are limited', () => {
    // Limit both accounts
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', {
      expiresAt: Date.now() + 2000
    })
    rateLimitStore.markLimit('provider-a', 'acc-2', 'gemini-pro', {
      expiresAt: Date.now() + 1000 // Expires sooner
    })

    const idx = manager.getNextAvailable('provider-a', 'gemini-pro', mockCredentials)
    expect(idx).toBe(1) // Should pick acc-2
  })

  it('markRateLimited marks the account in the store', async () => {
    await manager.markRateLimited('provider-a', 'gemini-pro', 0, 1000, 'test reason')
    
    const limit = rateLimitStore.getLimit('provider-a', 'acc-1', 'gemini-pro')
    expect(limit).not.toBeNull()
    expect(limit?.reason).toBe('test reason')
  })

  it('areAllRateLimited returns true only when all accounts are limited', () => {
    expect(manager.areAllRateLimited('provider-a', 'gemini-pro', mockCredentials)).toBe(false)

    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    expect(manager.areAllRateLimited('provider-a', 'gemini-pro', mockCredentials)).toBe(false)

    rateLimitStore.markLimit('provider-a', 'acc-2', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    expect(manager.areAllRateLimited('provider-a', 'gemini-pro', mockCredentials)).toBe(true)
  })

  it('getMinWaitTime returns correct wait time', () => {
    const now = Date.now()
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', { expiresAt: now + 2000 })
    rateLimitStore.markLimit('provider-a', 'acc-2', 'gemini-pro', { expiresAt: now + 1000 })

    const wait = manager.getMinWaitTime('provider-a', 'gemini-pro', mockCredentials)
    // Should be close to 1000
    expect(wait).toBeGreaterThan(900)
    expect(wait).toBeLessThan(1100)
  })

  it('hasNext returns true if there are other available accounts', () => {
    // Current index 0
    expect(manager.hasNext('provider-a', 'gemini-pro', 0, mockCredentials)).toBe(true)
    
    // Limit account 1 (index 0)
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    // Should still have next (acc-2)
    expect(manager.hasNext('provider-a', 'gemini-pro', 0, mockCredentials)).toBe(true)
    
    // Limit account 2 (index 1)
    rateLimitStore.markLimit('provider-a', 'acc-2', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    // No more available
    expect(manager.hasNext('provider-a', 'gemini-pro', 0, mockCredentials)).toBe(false)
  })

  it('getCredential rotates to next available account', async () => {
    // Limit account 1
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    
    // Request credential, starting from index 0
    const result = await manager.getCredential('provider-a', 'gemini-pro', 0)
    
    expect(result).not.toBeNull()
    expect(result?.accountIndex).toBe(1)
    expect(result?.accountId).toBe('acc-2')
  })
  
  it('getCredential returns null if all accounts limited', async () => {
    // Limit both
    rateLimitStore.markLimit('provider-a', 'acc-1', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    rateLimitStore.markLimit('provider-a', 'acc-2', 'gemini-pro', { expiresAt: Date.now() + 1000 })
    
    const result = await manager.getCredential('provider-a', 'gemini-pro', 0)
    
    expect(result).toBeNull()
  })
})
