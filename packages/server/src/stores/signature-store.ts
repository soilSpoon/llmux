import Database from 'bun:sqlite'
import crypto from 'node:crypto'

export interface SignatureRecord {
  signatureHash: string
  projectId: string
  provider: string
  endpoint: string
  account: string
  createdAt: number
  lastUsedAt: number
}

export interface SaveOptions {
  signature: string
  projectId: string
  provider: string
  endpoint: string
  account: string
}

export interface SignatureStoreOptions {
  maxEntries?: number
  ttlMs?: number
}

export class SignatureStore {
  private db: Database
  private readonly TTL_MS: number
  private readonly MAX_ENTRIES: number

  constructor(dbPath?: string, options?: SignatureStoreOptions) {
    this.TTL_MS = options?.ttlMs ?? 7 * 24 * 60 * 60 * 1000 // 7 days
    this.MAX_ENTRIES = options?.maxEntries ?? 1000

    this.db = new Database(dbPath ?? ':memory:')
    this.initializeSchema()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signatures (
        signatureHash TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        account TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastUsedAt INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_signatures_lastUsedAt ON signatures(lastUsedAt)
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_signatures_createdAt ON signatures(createdAt)
    `)
  }

  private hash(signature: string): string {
    return crypto.createHash('sha256').update(signature).digest('hex')
  }

  saveSignature(options: SaveOptions): void {
    const { signature, projectId, provider, endpoint, account } = options
    const signatureHash = this.hash(signature)
    const now = Date.now()

    this.db
      .prepare(
        `
      INSERT INTO signatures (signatureHash, projectId, provider, endpoint, account, createdAt, lastUsedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signatureHash) DO UPDATE SET
        projectId = excluded.projectId,
        provider = excluded.provider,
        endpoint = excluded.endpoint,
        account = excluded.account,
        lastUsedAt = excluded.lastUsedAt
    `
      )
      .run(signatureHash, projectId, provider, endpoint, account, now, now)

    this.cleanup()
  }

  getRecord(signature: string): SignatureRecord | null {
    const signatureHash = this.hash(signature)
    const now = Date.now()
    const cutoff = now - this.TTL_MS

    const row = this.db
      .prepare(
        `
      SELECT signatureHash, projectId, provider, endpoint, account, createdAt, lastUsedAt
      FROM signatures
      WHERE signatureHash = ? AND createdAt > ?
    `
      )
      .get(signatureHash, cutoff) as SignatureRecord | undefined

    if (!row) {
      return null
    }

    this.db
      .prepare(`UPDATE signatures SET lastUsedAt = ? WHERE signatureHash = ?`)
      .run(now, signatureHash)

    return {
      ...row,
      lastUsedAt: now,
    }
  }

  isValidForProject(signature: string, targetProjectId: string): boolean {
    const record = this.getRecord(signature)
    if (!record) {
      return false
    }
    return record.projectId === targetProjectId
  }

  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.TTL_MS

    this.db.prepare(`DELETE FROM signatures WHERE createdAt <= ?`).run(cutoff)

    const countResult = this.db.prepare(`SELECT COUNT(*) as count FROM signatures`).get() as {
      count: number
    }

    if (countResult.count > this.MAX_ENTRIES) {
      const excess = countResult.count - this.MAX_ENTRIES
      this.db
        .prepare(
          `
        DELETE FROM signatures WHERE signatureHash IN (
          SELECT signatureHash FROM signatures
          ORDER BY lastUsedAt ASC
          LIMIT ?
        )
      `
        )
        .run(excess)
    }
  }

  close(): void {
    this.db.close()
  }
}
