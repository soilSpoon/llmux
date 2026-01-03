import { type CacheEntry, MemoryStorage, type SignatureStorage } from './storage'

export type ModelFamily = 'claude' | 'gemini' | 'openai'

export interface CacheKey {
  sessionId: string
  model: string
  textHash: string
}

export interface SignatureCacheOptions {
  ttl?: number
  maxEntriesPerSession?: number
  storage?: SignatureStorage
}

export class SignatureCache {
  private readonly storage: SignatureStorage
  private readonly ttl: number
  private readonly maxEntriesPerSession: number

  constructor(options: SignatureCacheOptions = {}) {
    this.storage = options.storage ?? new MemoryStorage()
    this.ttl = options.ttl ?? 60 * 60 * 1000
    this.maxEntriesPerSession = options.maxEntriesPerSession ?? 100
  }

  store(key: CacheKey, signature: string, family: ModelFamily): void {
    const { sessionId, model, textHash } = key
    const entryKey = `${model}:${textHash}`

    const entry: CacheEntry = {
      signature,
      family,
      timestamp: Date.now(),
      sessionId,
    }

    this.storage.set(sessionId, entryKey, entry)
    this.enforceMaxEntries(sessionId)
  }

  restore(key: CacheKey): string | undefined {
    const { sessionId, model, textHash } = key
    const entryKey = `${model}:${textHash}`
    const now = Date.now()

    this.cleanupExpired(sessionId, now)

    const entry = this.storage.get(sessionId, entryKey)
    if (!entry) return undefined

    if (now - entry.timestamp > this.ttl) {
      this.storage.delete(sessionId, entryKey)
      return undefined
    }

    return entry.signature
  }

  validate(signature: string): boolean {
    return signature.length >= 50
  }

  clear(sessionId: string): void {
    this.storage.clearSession(sessionId)
  }

  private enforceMaxEntries(sessionId: string): void {
    while (this.storage.getSessionEntryCount(sessionId) > this.maxEntriesPerSession) {
      const oldestKey = this.findOldestEntry(sessionId)
      if (oldestKey) {
        this.storage.delete(sessionId, oldestKey)
      } else {
        break
      }
    }
  }

  private cleanupExpired(sessionId: string, now: number): void {
    const entries = this.storage.getSessionEntries(sessionId)
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > this.ttl) {
        this.storage.delete(sessionId, key)
      }
    }
  }

  private findOldestEntry(sessionId: string): string | null {
    const entries = this.storage.getSessionEntries(sessionId)
    let oldestKey: string | null = null
    let oldestTimestamp = Infinity

    for (const [key, entry] of entries) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
        oldestKey = key
      }
    }

    return oldestKey
  }
}

export function getModelFamily(model: string): ModelFamily {
  const lowerModel = model.toLowerCase()
  // gemini-claude-* models use Claude behavior
  if (lowerModel.includes('claude')) return 'claude'
  if (lowerModel.startsWith('gemini')) return 'gemini'
  if (lowerModel.startsWith('gpt')) return 'openai'
  if (lowerModel.startsWith('o1') || lowerModel.startsWith('o3')) return 'openai'
  return 'openai'
}

export function createTextHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

export { type CacheEntry, MemoryStorage, type SignatureStorage, SQLiteStorage } from './storage'
