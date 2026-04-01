// cortex/notifications.ts — Persistent notification store (PostgreSQL)
// Sources: reflex alerts, pulse reports, trace completions.
// Console polls these for the notification bell.

import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'cortex:notifications' })

export interface NotificationInput {
  source: 'reflex' | 'pulse' | 'trace'
  severity: 'critical' | 'degraded' | 'info' | 'success'
  title: string
  body?: string
  metadata?: Record<string, unknown>
}

export interface Notification {
  id: string
  source: string
  severity: string
  title: string
  body: string | null
  metadata: Record<string, unknown>
  read: boolean
  created_at: string
}

/**
 * Create a notification.
 */
export async function create(db: Pool, input: NotificationInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO notifications (source, severity, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.source, input.severity, input.title, input.body ?? null, JSON.stringify(input.metadata ?? {})],
    )
  } catch (err) {
    logger.warn({ err, source: input.source }, 'Failed to create notification')
  }
}

/**
 * List recent notifications (read + unread), most recent first.
 */
export async function listRecent(db: Pool, limit = 30): Promise<Notification[]> {
  try {
    const result = await db.query(
      `SELECT id, source, severity, title, body, metadata, read, created_at
       FROM notifications ORDER BY created_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows as Notification[]
  } catch {
    return []
  }
}

/**
 * Count unread notifications.
 */
export async function countUnread(db: Pool): Promise<number> {
  try {
    const result = await db.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE read = false`)
    return (result.rows[0] as { count: number } | undefined)?.count ?? 0
  } catch {
    return 0
  }
}

/**
 * Mark a single notification as read.
 */
export async function markRead(db: Pool, id: string): Promise<void> {
  await db.query(`UPDATE notifications SET read = true WHERE id = $1`, [id])
}

/**
 * Mark all notifications as read.
 */
export async function markAllRead(db: Pool): Promise<void> {
  await db.query(`UPDATE notifications SET read = true WHERE read = false`)
}

/**
 * Delete notifications older than N days.
 */
export async function cleanup(db: Pool, daysToKeep = 30): Promise<number> {
  try {
    const result = await db.query(
      `DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(daysToKeep)],
    )
    const deleted = result.rowCount ?? 0
    if (deleted > 0) logger.debug({ deleted }, 'Cleaned up old notifications')
    return deleted
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up notifications')
    return 0
  }
}
