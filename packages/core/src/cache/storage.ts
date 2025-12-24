import type { ModelFamily } from './signature'

export interface CacheEntry {
  signature: string
  family: ModelFamily
  timestamp: number
  sessionId: string
}

export interface SignatureStorage {
  get(sessionId: string, entryKey: string): CacheEntry | undefined
  set(sessionId: string, entryKey: string, entry: CacheEntry): void
  delete(sessionId: string, entryKey: string): void
  clearSession(sessionId: string): void
  getSessionEntries(sessionId: string): Map<string, CacheEntry>
  getSessionEntryCount(sessionId: string): number
}

export class MemoryStorage implements SignatureStorage {
  private readonly cache: Map<string, Map<string, CacheEntry>> = new Map()

  get(sessionId: string, entryKey: string): CacheEntry | undefined {
    return this.cache.get(sessionId)?.get(entryKey)
  }

  set(sessionId: string, entryKey: string, entry: CacheEntry): void {
    let session = this.cache.get(sessionId)
    if (!session) {
      session = new Map()
      this.cache.set(sessionId, session)
    }
    session.set(entryKey, entry)
  }

  delete(sessionId: string, entryKey: string): void {
    this.cache.get(sessionId)?.delete(entryKey)
  }

  clearSession(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  getSessionEntries(sessionId: string): Map<string, CacheEntry> {
    return this.cache.get(sessionId) ?? new Map()
  }

  getSessionEntryCount(sessionId: string): number {
    return this.cache.get(sessionId)?.size ?? 0
  }
}

export class SQLiteStorage implements SignatureStorage {
  private db: ReturnType<typeof import('bun:sqlite').Database.prototype.constructor>

  constructor(dbPath: string = 'signatures.db') {
    const { Database } = require('bun:sqlite')
    this.db = new Database(dbPath)
    this.init()
  }

  private init(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS signatures (
        session_id TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        family TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (session_id, entry_key)
      )
    `)
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_session ON signatures(session_id)
    `)
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON signatures(timestamp)
    `)
  }

  get(sessionId: string, entryKey: string): CacheEntry | undefined {
    const row = this.db
      .query(
        'SELECT signature, family, timestamp FROM signatures WHERE session_id = ? AND entry_key = ?'
      )
      .get(sessionId, entryKey) as {
      signature: string
      family: ModelFamily
      timestamp: number
    } | null

    if (!row) return undefined

    return {
      signature: row.signature,
      family: row.family,
      timestamp: row.timestamp,
      sessionId,
    }
  }

  set(sessionId: string, entryKey: string, entry: CacheEntry): void {
    this.db.run(
      `INSERT OR REPLACE INTO signatures (session_id, entry_key, signature, family, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, entryKey, entry.signature, entry.family, entry.timestamp]
    )
  }

  delete(sessionId: string, entryKey: string): void {
    this.db.run('DELETE FROM signatures WHERE session_id = ? AND entry_key = ?', [
      sessionId,
      entryKey,
    ])
  }

  clearSession(sessionId: string): void {
    this.db.run('DELETE FROM signatures WHERE session_id = ?', [sessionId])
  }

  getSessionEntries(sessionId: string): Map<string, CacheEntry> {
    const rows = this.db
      .query('SELECT entry_key, signature, family, timestamp FROM signatures WHERE session_id = ?')
      .all(sessionId) as Array<{
      entry_key: string
      signature: string
      family: ModelFamily
      timestamp: number
    }>

    const entries = new Map<string, CacheEntry>()
    for (const row of rows) {
      entries.set(row.entry_key, {
        signature: row.signature,
        family: row.family,
        timestamp: row.timestamp,
        sessionId,
      })
    }
    return entries
  }

  getSessionEntryCount(sessionId: string): number {
    const result = this.db
      .query('SELECT COUNT(*) as count FROM signatures WHERE session_id = ?')
      .get(sessionId) as { count: number }
    return result.count
  }

  close(): void {
    this.db.close()
  }

  cleanupExpired(ttl: number): number {
    const cutoff = Date.now() - ttl
    const result = this.db.run('DELETE FROM signatures WHERE timestamp < ?', [cutoff])
    return result.changes
  }
}
