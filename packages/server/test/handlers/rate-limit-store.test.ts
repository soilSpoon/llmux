import { describe, expect, it, beforeEach } from 'bun:test'
import { InMemoryRateLimitStore, type RateLimit } from '../../src/handlers/rate-limit-store'

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore

  beforeEach(() => {
    store = new InMemoryRateLimitStore()
  })

  it('marks and retrieves a rate limit', () => {
    const limit: RateLimit = {
      expiresAt: Date.now() + 1000,
      reason: 'Too many requests'
    }

    store.markLimit('provider-a', 'account-1', 'gpt-4', limit)
    
    const retrieved = store.getLimit('provider-a', 'account-1', 'gpt-4')
    expect(retrieved).toEqual(limit)
  })

  it('returns null for non-existent limit', () => {
    const retrieved = store.getLimit('provider-a', 'account-non-existent', 'gpt-4')
    expect(retrieved).toBeNull()
  })

  it('removes expired limits on retrieval', async () => {
    const limit: RateLimit = {
      expiresAt: Date.now() - 100, // Expired
      reason: 'Expired limit'
    }

    store.markLimit('provider-a', 'account-1', 'gpt-4', limit)
    
    // Should return null and clean up
    const retrieved = store.getLimit('provider-a', 'account-1', 'gpt-4')
    expect(retrieved).toBeNull()
  })

  it('clears a limit explicitly', () => {
    const limit: RateLimit = {
      expiresAt: Date.now() + 10000,
      reason: 'Manual clear'
    }

    store.markLimit('provider-a', 'account-1', 'gpt-4', limit)
    store.clearLimit('provider-a', 'account-1', 'gpt-4')
    
    expect(store.getLimit('provider-a', 'account-1', 'gpt-4')).toBeNull()
  })

  it('gets all limits for a provider family', () => {
    const limit1: RateLimit = { expiresAt: Date.now() + 1000 }
    const limit2: RateLimit = { expiresAt: Date.now() + 2000 }
    
    store.markLimit('provider-a', 'account-1', 'gpt-4', limit1)
    store.markLimit('provider-a', 'account-2', 'gpt-4', limit2)
    store.markLimit('provider-a', 'account-3', 'other-family', limit1) // Should not be included
    
    const limits = store.getLimits('provider-a', 'gpt-4')
    
    expect(limits.size).toBe(2)
    expect(limits.get('account-1')).toEqual(limit1)
    expect(limits.get('account-2')).toEqual(limit2)
    expect(limits.has('account-3')).toBe(false)
  })

  it('cleans up expired limits when getting all limits', () => {
    const activeLimit: RateLimit = { expiresAt: Date.now() + 1000 }
    const expiredLimit: RateLimit = { expiresAt: Date.now() - 1000 }
    
    store.markLimit('provider-a', 'account-1', 'gpt-4', activeLimit)
    store.markLimit('provider-a', 'account-2', 'gpt-4', expiredLimit)
    
    const limits = store.getLimits('provider-a', 'gpt-4')
    
    expect(limits.size).toBe(1)
    expect(limits.get('account-1')).toEqual(activeLimit)
    expect(limits.has('account-2')).toBe(false)
    
    // Double check it was removed
    expect(store.getLimit('provider-a', 'account-2', 'gpt-4')).toBeNull()
  })
})
