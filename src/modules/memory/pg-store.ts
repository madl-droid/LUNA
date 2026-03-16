// LUNA — PostgreSQL persistent store for messages

import type { Pool } from 'pg'
import pino from 'pino'
import type { StoredMessage } from './types.js'

const logger = pino({ name: 'memory:pg-store' })

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`

export class PgStore {
  constructor(private pool: Pool) {}

  async ensureTable(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(CREATE_TABLE_SQL)
      logger.info('PostgreSQL messages table ensured')
    } finally {
      client.release()
    }
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO messages (id, session_id, channel_name, sender_type, sender_id, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          message.sessionId,
          message.channelName,
          message.senderType,
          message.senderId,
          JSON.stringify(message.content),
          message.createdAt,
        ],
      )
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Failed to persist message to PostgreSQL')
    }
  }

  async getSessionMessages(sessionId: string, limit = 100): Promise<StoredMessage[]> {
    const result = await this.pool.query(
      `SELECT id, session_id, channel_name, sender_type, sender_id, content, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, limit],
    )

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      channelName: row.channel_name,
      senderType: row.sender_type,
      senderId: row.sender_id,
      content: row.content,
      createdAt: new Date(row.created_at),
    }))
  }
}
