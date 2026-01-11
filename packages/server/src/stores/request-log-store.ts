/**
 * SQLite-based Request Log Store
 *
 * Stores transformation logs for debugging and analysis:
 * - Pre-transform request (original client request)
 * - Post-transform request (upstream provider request)
 * - Pre-transform response (upstream provider response)
 * - Post-transform response (final client response)
 * - Routing metadata (from/to provider, model, endpoint)
 */

import { Database } from 'bun:sqlite'
import type { ProviderName } from '@llmux/core'
import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'request-log-store' })

export interface RequestLogEntry {
  id?: number
  requestId: string
  timestamp: string

  // Source (Client)
  sourceProvider: string
  sourceModel: string
  sourceEndpoint: string

  // Target (Upstream)
  targetProvider: string
  targetModel: string
  targetEndpoint: string

  // Request Bodies
  preTransformRequest: string
  postTransformRequest: string

  // Response Bodies
  preTransformResponse: string | null
  postTransformResponse: string | null

  // Metadata
  statusCode: number | null
  durationMs: number | null
  isStreaming: boolean
  errorMessage: string | null
}

export interface LogRequestInput {
  requestId: string
  sourceProvider: string
  sourceModel: string
  sourceEndpoint: string
  targetProvider: ProviderName
  targetModel: string
  targetEndpoint: string
  preTransformRequest: unknown
  postTransformRequest: unknown
  isStreaming: boolean
}

export interface LogResponseInput {
  requestId: string
  preTransformResponse: unknown
  postTransformResponse: unknown
  statusCode: number
  durationMs: number
  errorMessage?: string
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    
    -- Source (Client)
    source_provider TEXT NOT NULL,
    source_model TEXT NOT NULL,
    source_endpoint TEXT NOT NULL,
    
    -- Target (Upstream)
    target_provider TEXT NOT NULL,
    target_model TEXT NOT NULL,
    target_endpoint TEXT NOT NULL,
    
    -- Request Bodies (JSON strings)
    pre_transform_request TEXT NOT NULL,
    post_transform_request TEXT NOT NULL,
    
    -- Response Bodies (JSON strings, nullable for pending requests)
    pre_transform_response TEXT,
    post_transform_response TEXT,
    
    -- Metadata
    status_code INTEGER,
    duration_ms INTEGER,
    is_streaming INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    
    -- Indexes
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_request_logs_request_id ON request_logs(request_id);
  CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_request_logs_source_provider ON request_logs(source_provider);
  CREATE INDEX IF NOT EXISTS idx_request_logs_target_provider ON request_logs(target_provider);
`

export class RequestLogStore {
  private db: Database
  private insertRequestStmt: ReturnType<Database['prepare']>
  private updateResponseStmt: ReturnType<Database['prepare']>
  private selectByIdStmt: ReturnType<Database['prepare']>
  private selectRecentStmt: ReturnType<Database['prepare']>

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(CREATE_TABLE_SQL)

    this.insertRequestStmt = this.db.prepare(`
      INSERT INTO request_logs (
        request_id, timestamp,
        source_provider, source_model, source_endpoint,
        target_provider, target_model, target_endpoint,
        pre_transform_request, post_transform_request,
        is_streaming
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.updateResponseStmt = this.db.prepare(`
      UPDATE request_logs SET
        pre_transform_response = ?,
        post_transform_response = ?,
        status_code = ?,
        duration_ms = ?,
        error_message = ?
      WHERE request_id = ?
    `)

    this.selectByIdStmt = this.db.prepare(`
      SELECT * FROM request_logs WHERE request_id = ?
    `)

    this.selectRecentStmt = this.db.prepare(`
      SELECT * FROM request_logs ORDER BY timestamp DESC LIMIT ?
    `)

    logger.info({ dbPath }, 'RequestLogStore initialized')
  }

  logRequest(input: LogRequestInput): void {
    try {
      const timestamp = new Date().toISOString()
      this.insertRequestStmt.run(
        input.requestId,
        timestamp,
        input.sourceProvider,
        input.sourceModel,
        input.sourceEndpoint,
        input.targetProvider,
        input.targetModel,
        input.targetEndpoint,
        safeStringify(input.preTransformRequest),
        safeStringify(input.postTransformRequest),
        input.isStreaming ? 1 : 0
      )
      logger.debug({ requestId: input.requestId }, 'Request logged')
    } catch (error) {
      logger.error({ error, requestId: input.requestId }, 'Failed to log request')
    }
  }

  logResponse(input: LogResponseInput): void {
    try {
      this.updateResponseStmt.run(
        safeStringify(input.preTransformResponse),
        safeStringify(input.postTransformResponse),
        input.statusCode,
        input.durationMs,
        input.errorMessage ?? null,
        input.requestId
      )
      logger.debug({ requestId: input.requestId, statusCode: input.statusCode }, 'Response logged')
    } catch (error) {
      logger.error({ error, requestId: input.requestId }, 'Failed to log response')
    }
  }

  getByRequestId(requestId: string): RequestLogEntry | null {
    const row = this.selectByIdStmt.get(requestId) as DbRow | null
    return row ? mapRowToEntry(row) : null
  }

  getRecent(limit: number = 100): RequestLogEntry[] {
    const rows = this.selectRecentStmt.all(limit) as DbRow[]
    return rows.map(mapRowToEntry)
  }

  close(): void {
    this.db.close()
    logger.info('RequestLogStore closed')
  }
}

interface DbRow {
  id: number
  request_id: string
  timestamp: string
  source_provider: string
  source_model: string
  source_endpoint: string
  target_provider: string
  target_model: string
  target_endpoint: string
  pre_transform_request: string
  post_transform_request: string
  pre_transform_response: string | null
  post_transform_response: string | null
  status_code: number | null
  duration_ms: number | null
  is_streaming: number
  error_message: string | null
}

function mapRowToEntry(row: DbRow): RequestLogEntry {
  return {
    id: row.id,
    requestId: row.request_id,
    timestamp: row.timestamp,
    sourceProvider: row.source_provider,
    sourceModel: row.source_model,
    sourceEndpoint: row.source_endpoint,
    targetProvider: row.target_provider,
    targetModel: row.target_model,
    targetEndpoint: row.target_endpoint,
    preTransformRequest: row.pre_transform_request,
    postTransformRequest: row.post_transform_request,
    preTransformResponse: row.pre_transform_response,
    postTransformResponse: row.post_transform_response,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    isStreaming: row.is_streaming === 1,
    errorMessage: row.error_message,
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

let globalLogStore: RequestLogStore | null = null

export function getRequestLogStore(dbPath?: string): RequestLogStore {
  if (!globalLogStore) {
    const path = dbPath ?? process.env.LLMUX_LOG_DB ?? './llmux-logs.db'
    globalLogStore = new RequestLogStore(path)
  }
  return globalLogStore
}

export function closeRequestLogStore(): void {
  if (globalLogStore) {
    globalLogStore.close()
    globalLogStore = null
  }
}
