import { SignatureCache, SQLiteStorage } from '@llmux/core'

let globalCache: SignatureCache | null = null

export function clearSignatureCache(): void {
  globalCache = null
}

export function getSignatureCache(): SignatureCache {
  if (!globalCache) {
    // Only log once per instance
    console.log('[SignatureCache] Initializing global instance')
    globalCache = new SignatureCache({
      storage: new SQLiteStorage(), // Defaults to ~/.llmux/signatures.db
      ttl: 7 * 24 * 60 * 60 * 1000, // 7 days (match legacy store TTL)
      maxEntriesPerSession: 1000,
    })
  }
  return globalCache
}
