// LUNA Engine — Orphan Recovery
// Detects messages that never received a response and re-dispatches them.
// Detection: user messages with no agent reply within 5 minutes (grace period).

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { IncomingMessage, ChannelName, MessageContent } from '../../channels/types.js'

const logger = pino({ name: 'engine:proactive:orphan-recovery' })

const GRACE_PERIOD_MINUTES = 5   // never re-dispatch messages newer than this

export interface OrphanMessage {
  messageId: string
  contactId: string
  channelContactId: string
  channel: ChannelName
  content: MessageContent
  receivedAt: Date
  sessionId: string
}

/**
 * Find user messages that never received an agent response.
 *
 * Detection criteria:
 * 1. sender_type = 'user'
 * 2. created_at BETWEEN (now - windowMinutes) AND (now - 5 min grace)
 * 3. No agent message in the same session within 5 minutes of the user message
 * 4. Session has a known contact_id (anonymous sessions are skipped)
 */
export async function findOrphanMessages(
  db: Pool,
  windowMinutes = 30,
  limit = 10,
): Promise<OrphanMessage[]> {
  const sql = `
    SELECT
      m.id           AS message_id,
      m.content      AS content,
      m.created_at   AS received_at,
      s.id           AS session_id,
      s.contact_id   AS contact_id,
      s.channel_contact_id AS channel_contact_id,
      s.channel_name AS channel_name
    FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE m.sender_type = 'user'
      AND m.created_at >= now() - ($1 || ' minutes')::interval
      AND m.created_at <= now() - ($2 || ' minutes')::interval
      AND s.contact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM messages m2
        WHERE m2.session_id = m.session_id
          AND m2.sender_type = 'agent'
          AND m2.created_at > m.created_at
          AND m2.created_at <= m.created_at + ($2 || ' minutes')::interval
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pipeline_logs pl
        WHERE pl.session_id = m.session_id
          AND pl.created_at > m.created_at
          AND pl.created_at > now() - interval '5 minutes'
      )
    ORDER BY m.created_at ASC
    LIMIT $3
  `

  try {
    const result = await db.query<{
      message_id: string
      content: unknown
      received_at: Date
      session_id: string
      contact_id: string
      channel_contact_id: string
      channel_name: string
    }>(sql, [String(windowMinutes), String(GRACE_PERIOD_MINUTES), limit])

    return (result.rows as Array<{
      message_id: string
      content: unknown
      received_at: Date
      session_id: string
      contact_id: string
      channel_contact_id: string
      channel_name: string
    }>).map((row) => ({
      messageId: row.message_id,
      contactId: row.contact_id,
      channelContactId: row.channel_contact_id,
      channel: row.channel_name as ChannelName,
      content: (row.content as MessageContent) ?? { type: 'text', text: '' },
      receivedAt: row.received_at,
      sessionId: row.session_id,
    }))
  } catch (err) {
    logger.error({ err }, 'Error querying orphan messages')
    return []
  }
}

/**
 * Re-dispatch an orphan message via the message:incoming hook.
 * Constructs a synthetic IncomingMessage from stored data.
 */
export async function redispatchOrphan(
  orphan: OrphanMessage,
  registry: Registry,
): Promise<boolean> {
  const message: IncomingMessage = {
    id: randomUUID(),
    channelName: orphan.channel,
    channelMessageId: orphan.messageId, // original message ID
    from: orphan.channelContactId,
    timestamp: orphan.receivedAt,
    content: orphan.content,
  }

  try {
    await registry.runHook('message:incoming', message)
    logger.info({
      originalMessageId: orphan.messageId,
      contactId: orphan.contactId,
      channel: orphan.channel,
    }, 'Orphan message re-dispatched')
    return true
  } catch (err) {
    logger.error({
      err,
      originalMessageId: orphan.messageId,
      contactId: orphan.contactId,
    }, 'Failed to re-dispatch orphan message')
    return false
  }
}
