import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelCache } from '../cache'
import type { Model } from '../types'

describe('ModelCache', () => {
  const testCacheDir = join(tmpdir(), 'llmux-test-cache')

  beforeEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
    mkdirSync(testCacheDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
  })

  describe('createModelCache', () => {
    it('should create a cache instance with custom directory', () => {
      const cache = createModelCache(testCacheDir)
      expect(cache).toBeDefined()
      expect(cache.get).toBeFunction()
      expect(cache.set).toBeFunction()
      expect(cache.isExpired).toBeFunction()
    })
  })

  describe('set and get', () => {
    it('should store and retrieve models', async () => {
      const cache = createModelCache(testCacheDir)
      const models: Model[] = [{ id: 'gpt-4', provider: 'openai', name: 'GPT-4', object: 'model' }]

      await cache.set('openai', models)
      const retrieved = await cache.get('openai')

      expect(retrieved).toEqual(models)
    })

    it('should return null for non-existent cache', async () => {
      const cache = createModelCache(testCacheDir)
      const result = await cache.get('non-existent')
      expect(result).toBeNull()
    })

    it('should store models in separate files per provider', async () => {
      const cache = createModelCache(testCacheDir)

      await cache.set('openai', [
        { id: 'gpt-4', provider: 'openai', name: 'GPT-4', object: 'model' },
      ])
      await cache.set('anthropic', [
        {
          id: 'claude-3',
          provider: 'anthropic',
          name: 'Claude 3',
          object: 'model',
        },
      ])

      const openaiModels = await cache.get('openai')
      const anthropicModels = await cache.get('anthropic')

      expect(openaiModels).toHaveLength(1)
      expect(anthropicModels).toHaveLength(1)
      expect(openaiModels?.[0]?.id).toBe('gpt-4')
      expect(anthropicModels?.[0]?.id).toBe('claude-3')
    })
  })

  describe('isExpired', () => {
    it('should return true for non-existent cache', async () => {
      const cache = createModelCache(testCacheDir)
      const expired = await cache.isExpired('non-existent')
      expect(expired).toBe(true)
    })

    it('should return false for fresh cache', async () => {
      const cache = createModelCache(testCacheDir, { ttlMs: 60000 })
      await cache.set('openai', [
        { id: 'gpt-4', provider: 'openai', name: 'GPT-4', object: 'model' },
      ])

      const expired = await cache.isExpired('openai')
      expect(expired).toBe(false)
    })

    it('should return true for expired cache', async () => {
      const cache = createModelCache(testCacheDir, { ttlMs: 10 })
      await cache.set('openai', [
        { id: 'gpt-4', provider: 'openai', name: 'GPT-4', object: 'model' },
      ])

      await new Promise((resolve) => setTimeout(resolve, 150))

      const expired = await cache.isExpired('openai')
      expect(expired).toBe(true)
    })
  })

  describe('clear', () => {
    it('should clear cache for specific provider', async () => {
      const cache = createModelCache(testCacheDir)
      await cache.set('openai', [
        { id: 'gpt-4', provider: 'openai', name: 'GPT-4', object: 'model' },
      ])

      await cache.clear('openai')

      const result = await cache.get('openai')
      expect(result).toBeNull()
    })
  })
})
