import pg from 'pg';
import type { StoredMessage } from './types.js';

export class PgStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        session_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        content JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_session
      ON messages(session_id, created_at)
    `);
  }

  async saveMessage(message: StoredMessage): Promise<void> {
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
    );
  }

  async getSessionMessages(sessionId: string, limit?: number): Promise<StoredMessage[]> {
    const query = limit
      ? `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2`
      : `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC`;

    const params = limit ? [sessionId, limit] : [sessionId];
    const result = await this.pool.query(query, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      channelName: row['channel_name'] as string,
      senderType: row['sender_type'] as 'user' | 'agent',
      senderId: row['sender_id'] as string,
      content: row['content'] as StoredMessage['content'],
      createdAt: new Date(row['created_at'] as string),
    }));
  }

  async getRecentMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM (
        SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
      ) sub ORDER BY created_at ASC`,
      [sessionId, count],
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      channelName: row['channel_name'] as string,
      senderType: row['sender_type'] as 'user' | 'agent',
      senderId: row['sender_id'] as string,
      content: row['content'] as StoredMessage['content'],
      createdAt: new Date(row['created_at'] as string),
    }));
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM messages WHERE session_id = $1`,
      [sessionId],
    );
    return Number(result.rows[0]?.['count'] ?? 0);
  }

  async deleteSessionMessages(sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM messages WHERE session_id = $1`,
      [sessionId],
    );
  }
}
