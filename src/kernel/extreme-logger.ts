// LUNA — Extreme Logger
// When DEBUG_EXTREME_LOG=true, provides detailed logging for all system operations.
// When disabled, provides baseline logging (errors, basic requests, connections).

import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'extreme-logger' })

let _db: Pool | null = null

/** Initialize extreme logger with database pool reference */
export function initExtremeLogger(db: Pool): void {
  _db = db
}

/** Check if extreme logging is enabled */
export async function isExtremeLogEnabled(): Promise<boolean> {
  if (!_db) return false
  try {
    const result = await _db.query(`SELECT value FROM config_store WHERE key = 'DEBUG_EXTREME_LOG'`)
    return result.rows[0]?.value === 'true'
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════
// HTTP request/response logging
// ═══════════════════════════════════════════

export interface RequestLogData {
  method: string
  url: string
  status: number
  durationMs: number
  ip?: string
  contentLength?: number
  userAgent?: string
  requestBody?: string
  responseBody?: string
}

/** Log an HTTP request/response pair */
export async function logHttpRequest(data: RequestLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  if (extreme) {
    logger.info({
      type: 'http',
      method: data.method,
      url: data.url,
      status: data.status,
      durationMs: data.durationMs,
      ip: data.ip,
      contentLength: data.contentLength,
      userAgent: data.userAgent,
      requestBody: data.requestBody?.slice(0, 2000),
      responseBody: data.responseBody?.slice(0, 2000),
    }, `HTTP ${data.method} ${data.url} ${data.status} ${data.durationMs}ms`)
  } else if (data.status >= 400) {
    // Baseline: only log errors
    logger.warn({
      type: 'http',
      method: data.method,
      url: data.url,
      status: data.status,
      durationMs: data.durationMs,
    }, `HTTP ${data.method} ${data.url} ${data.status}`)
  }
}

// ═══════════════════════════════════════════
// SQL query logging
// ═══════════════════════════════════════════

export interface SqlLogData {
  query: string
  params?: unknown[]
  durationMs: number
  rowCount?: number
  error?: string
}

/** Log a SQL query execution */
export async function logSqlQuery(data: SqlLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  if (extreme) {
    logger.info({
      type: 'sql',
      query: data.query.slice(0, 1000),
      params: data.params?.slice(0, 10),
      durationMs: data.durationMs,
      rowCount: data.rowCount,
    }, `SQL ${data.durationMs}ms rows=${data.rowCount ?? '?'}`)
  } else if (data.error) {
    logger.error({
      type: 'sql',
      query: data.query.slice(0, 500),
      error: data.error,
      durationMs: data.durationMs,
    }, `SQL error: ${data.error}`)
  }
}

// ═══════════════════════════════════════════
// Redis operation logging
// ═══════════════════════════════════════════

export interface RedisLogData {
  command: string
  key?: string
  durationMs: number
  error?: string
}

/** Log a Redis operation */
export async function logRedisOp(data: RedisLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  if (extreme) {
    logger.info({
      type: 'redis',
      command: data.command,
      key: data.key,
      durationMs: data.durationMs,
    }, `Redis ${data.command} ${data.key ?? ''} ${data.durationMs}ms`)
  } else if (data.error) {
    logger.error({
      type: 'redis',
      command: data.command,
      key: data.key,
      error: data.error,
    }, `Redis error: ${data.error}`)
  }
}

// ═══════════════════════════════════════════
// External API call logging (LLM, etc.)
// ═══════════════════════════════════════════

export interface ExternalApiLogData {
  provider: string
  endpoint: string
  method: string
  durationMs: number
  status?: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  model?: string
  error?: string
}

/** Log an external API call */
export async function logExternalApi(data: ExternalApiLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  if (extreme) {
    logger.info({
      type: 'external_api',
      provider: data.provider,
      endpoint: data.endpoint,
      method: data.method,
      status: data.status,
      durationMs: data.durationMs,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      costUsd: data.costUsd,
      model: data.model,
    }, `API ${data.provider} ${data.method} ${data.endpoint} ${data.status ?? '?'} ${data.durationMs}ms`)
  } else if (data.error) {
    logger.error({
      type: 'external_api',
      provider: data.provider,
      endpoint: data.endpoint,
      error: data.error,
      durationMs: data.durationMs,
    }, `API error ${data.provider}: ${data.error}`)
  }
}

// ═══════════════════════════════════════════
// Channel/provider message logging
// ═══════════════════════════════════════════

export interface ChannelMessageLogData {
  channel: string
  direction: 'inbound' | 'outbound'
  contactId: string
  messageType?: string
  textPreview?: string
  metadata?: Record<string, unknown>
}

/** Log a channel message (WhatsApp, email, etc.) */
export async function logChannelMessage(data: ChannelMessageLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  if (extreme) {
    logger.info({
      type: 'channel_message',
      channel: data.channel,
      direction: data.direction,
      contactId: data.contactId,
      messageType: data.messageType,
      textPreview: data.textPreview?.slice(0, 500),
      metadata: data.metadata,
    }, `${data.channel} ${data.direction} from=${data.contactId}`)
  }
  // Baseline: channel messages are already logged by individual modules
}

// ═══════════════════════════════════════════
// Connection event logging
// ═══════════════════════════════════════════

export interface ConnectionLogData {
  service: string
  event: 'connected' | 'disconnected' | 'error' | 'reconnecting'
  details?: string
}

/** Log a connection event (always logs, more detail when extreme) */
export async function logConnection(data: ConnectionLogData): Promise<void> {
  const extreme = await isExtremeLogEnabled()
  const msg = `${data.service} ${data.event}${data.details ? ': ' + data.details : ''}`
  if (data.event === 'error') {
    logger.error({ type: 'connection', ...data }, msg)
  } else if (extreme || data.event === 'disconnected') {
    logger.info({ type: 'connection', ...data }, msg)
  }
}
