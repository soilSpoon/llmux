import { describe, it, expect, beforeEach } from 'bun:test'

describe('SignatureCache', () => {
  describe('Constructor', () => {
    it('should create a new cache instance with default options', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      expect(cache).toBeInstanceOf(SignatureCache)
    })

    it('should create a new cache instance with custom options', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache({ ttl: 5000, maxEntriesPerSession: 10 })
      expect(cache).toBeInstanceOf(SignatureCache)
    })
  })

  describe('store()', () => {
    it('should store a signature with the given key', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const signature = 'a'.repeat(50)
      const family = 'claude' as const

      cache.store(key, signature, family)

      const restored = cache.restore(key)
      expect(restored).toBe(signature)
    })

    it('should overwrite existing entry with the same key', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const signature1 = 'a'.repeat(50)
      const signature2 = 'b'.repeat(50)
      const family = 'claude' as const

      cache.store(key, signature1, family)
      cache.store(key, signature2, family)

      const restored = cache.restore(key)
      expect(restored).toBe(signature2)
    })

    it('should enforce max entries limit (100 per session)', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache({ maxEntriesPerSession: 3, ttl: 60000 })
      const family = 'claude' as const

      for (let i = 0; i < 5; i++) {
        cache.store(
          { sessionId: 'session-1', model: 'claude-3', textHash: `hash-${i}` },
          `sig-${i}`.repeat(10),
          family
        )
      }

      const restored = cache.restore({
        sessionId: 'session-1',
        model: 'claude-3',
        textHash: 'hash-0',
      })
      expect(restored).toBeUndefined()
    })
  })

  describe('restore()', () => {
    it('should return stored signature for valid key', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const signature = 'a'.repeat(50)
      const family = 'claude' as const

      cache.store(key, signature, family)
      const restored = cache.restore(key)

      expect(restored).toBe(signature)
    })

    it('should return undefined for non-existent key', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const restored = cache.restore(key)

      expect(restored).toBeUndefined()
    })

    it('should return undefined for expired entries (TTL 1 hour)', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache({ ttl: 100 })
      const key = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const signature = 'a'.repeat(50)
      const family = 'claude' as const

      cache.store(key, signature, family)

      await new Promise<void>((resolve) => setTimeout(resolve, 150))

      const restored = cache.restore(key)
      expect(restored).toBeUndefined()
    })
  })

  describe('validate()', () => {
    it('should return true for valid signatures (>= 50 chars)', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()

      const validSignature = 'a'.repeat(50)
      expect(cache.validate(validSignature)).toBe(true)
      expect(cache.validate('a'.repeat(100))).toBe(true)
    })

    it('should return false for short signatures (< 50 chars)', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()

      const shortSignature = 'a'.repeat(49)
      expect(cache.validate(shortSignature)).toBe(false)
      expect(cache.validate('')).toBe(false)
    })
  })

  describe('clear()', () => {
    it('should clear all entries for a session', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key1 = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const key2 = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-2' }
      const family = 'claude' as const

      cache.store(key1, 'a'.repeat(50), family)
      cache.store(key2, 'b'.repeat(50), family)

      cache.clear('session-1')

      expect(cache.restore(key1)).toBeUndefined()
      expect(cache.restore(key2)).toBeUndefined()
    })

    it('should not affect other sessions', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const key1 = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const key2 = { sessionId: 'session-2', model: 'claude-3', textHash: 'hash-1' }
      const family = 'claude' as const

      cache.store(key1, 'a'.repeat(50), family)
      cache.store(key2, 'b'.repeat(50), family)

      cache.clear('session-1')

      expect(cache.restore(key1)).toBeUndefined()
      expect(cache.restore(key2)).toBe('b'.repeat(50))
    })
  })

  describe('Model family isolation', () => {
    it('should isolate claude signatures from gemini', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache()
      const claudeKey = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const geminiKey = { sessionId: 'session-1', model: 'gemini-2', textHash: 'hash-1' }

      cache.store(claudeKey, 'claude-signature'.repeat(10), 'claude')
      cache.store(geminiKey, 'gemini-signature'.repeat(10), 'gemini')

      expect(cache.restore(claudeKey)).toBe('claude-signature'.repeat(10))
      expect(cache.restore(geminiKey)).toBe('gemini-signature'.repeat(10))
    })
  })

  describe('Cleanup', () => {
    it('should remove expired entries on access', async () => {
      const { SignatureCache } = await import('../../src/cache/signature')
      const cache = new SignatureCache({ ttl: 100 })
      const key1 = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-1' }
      const key2 = { sessionId: 'session-1', model: 'claude-3', textHash: 'hash-2' }
      const family = 'claude' as const

      cache.store(key1, 'a'.repeat(50), family)

      await new Promise<void>((resolve) => setTimeout(resolve, 150))

      cache.store(key2, 'b'.repeat(50), family)
      expect(cache.restore(key1)).toBeUndefined()
      expect(cache.restore(key2)).toBe('b'.repeat(50))
    })
  })
})

describe('getModelFamily', () => {
  it('should return claude for claude models', async () => {
    const { getModelFamily } = await import('../../src/cache/signature')
    expect(getModelFamily('claude-3-opus')).toBe('claude')
    expect(getModelFamily('claude-3-sonnet')).toBe('claude')
    expect(getModelFamily('claude-3-haiku')).toBe('claude')
  })

  it('should return gemini for gemini models', async () => {
    const { getModelFamily } = await import('../../src/cache/signature')
    expect(getModelFamily('gemini-2.5-flash')).toBe('gemini')
    expect(getModelFamily('gemini-2.5-pro')).toBe('gemini')
    expect(getModelFamily('gemini-2.0')).toBe('gemini')
  })

  it('should return openai for openai models', async () => {
    const { getModelFamily } = await import('../../src/cache/signature')
    expect(getModelFamily('gpt-4')).toBe('openai')
    expect(getModelFamily('gpt-3.5-turbo')).toBe('openai')
    expect(getModelFamily('o1')).toBe('openai')
    expect(getModelFamily('o3')).toBe('openai')
  })

  it('should return openai as default', async () => {
    const { getModelFamily } = await import('../../src/cache/signature')
    expect(getModelFamily('unknown-model')).toBe('openai')
  })
})

describe('createTextHash', () => {
  it('should create consistent hash for same text', async () => {
    const { createTextHash } = await import('../../src/cache/signature')
    const hash1 = createTextHash('test text')
    const hash2 = createTextHash('test text')
    expect(hash1).toBe(hash2)
  })

  it('should create different hash for different text', async () => {
    const { createTextHash } = await import('../../src/cache/signature')
    const hash1 = createTextHash('text 1')
    const hash2 = createTextHash('text 2')
    expect(hash1).not.toBe(hash2)
  })

  it('should create hash as string', async () => {
    const { createTextHash } = await import('../../src/cache/signature')
    const hash = createTextHash('test')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })
})
