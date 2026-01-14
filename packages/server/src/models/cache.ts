import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getHomeDir } from '@llmux/core'
import type { Model, ModelProvider } from './types'

export interface CacheOptions {
  ttlMs?: number // Time-to-live in milliseconds (default: 1 hour)
}

interface CacheEntry {
  models: Model[]
  timestamp: number
}

export interface ModelCache {
  get(provider: ModelProvider): Promise<Model[] | null>
  set(provider: ModelProvider, models: Model[]): Promise<void>
  isExpired(provider: ModelProvider): Promise<boolean>
  clear(provider: ModelProvider): Promise<void>
}

const DEFAULT_TTL_MS = 60 * 60 * 1000 // 1 hour

export function createModelCache(cacheDir?: string, options: CacheOptions = {}): ModelCache {
  const actualCacheDir = cacheDir ?? join(getHomeDir(), '.cache', 'llmux')
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  const getCachePath = (provider: ModelProvider): string => {
    return join(actualCacheDir, `models-${provider}.json`)
  }

  const ensureCacheDir = (): void => {
    if (!existsSync(actualCacheDir)) {
      mkdirSync(actualCacheDir, { recursive: true })
    }
  }

  return {
    async get(provider: ModelProvider): Promise<Model[] | null> {
      const cachePath = getCachePath(provider)

      if (!existsSync(cachePath)) {
        return null
      }

      try {
        const content = readFileSync(cachePath, 'utf-8')
        const entry: CacheEntry = JSON.parse(content)
        return entry.models
      } catch {
        return null
      }
    },

    async set(provider: ModelProvider, models: Model[]): Promise<void> {
      ensureCacheDir()
      const cachePath = getCachePath(provider)
      const entry: CacheEntry = {
        models,
        timestamp: Date.now(),
      }
      writeFileSync(cachePath, JSON.stringify(entry, null, 2))
    },

    async isExpired(provider: ModelProvider): Promise<boolean> {
      const cachePath = getCachePath(provider)

      if (!existsSync(cachePath)) {
        return true
      }

      try {
        const content = readFileSync(cachePath, 'utf-8')
        const entry: CacheEntry = JSON.parse(content)
        const age = Date.now() - entry.timestamp
        return age > ttlMs
      } catch {
        return true
      }
    },

    async clear(provider: ModelProvider): Promise<void> {
      const cachePath = getCachePath(provider)
      if (existsSync(cachePath)) {
        unlinkSync(cachePath)
      }
    },
  }
}
