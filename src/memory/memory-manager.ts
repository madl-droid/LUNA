import type { StoredMessage, SessionMeta } from './types.js';
import type { RedisBuffer } from './redis-buffer.js';
import type { PgStore } from './pg-store.js';
import { getConfig } from '../config.js';

export class MemoryManager {
  constructor(
    private redisBuffer: RedisBuffer,
    private pgStore: PgStore,
  ) {}

  async saveMessage(message: StoredMessage): Promise<void> {
    // Write to Redis synchronously (fast, for pipeline reads)
    await this.redisBuffer.saveMessage(message);

    // Write to PostgreSQL asynchronously (fire-and-forget with error logging)
    this.pgStore.saveMessage(message).catch((err) => {
      console.error('[MemoryManager] Async PG write failed:', err);
    });
  }

  async getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
    // Try Redis first (fast path)
    const hasRedis = await this.redisBuffer.hasSession(sessionId);
    if (hasRedis) {
      return this.redisBuffer.getMessages(sessionId);
    }

    // Fallback to PostgreSQL if Redis doesn't have the data
    const pgMessages = await this.pgStore.getSessionMessages(sessionId);
    if (pgMessages.length > 0) {
      // Rehydrate Redis with the PG data
      await this.redisBuffer.replaceMessages(sessionId, pgMessages);
    }
    return pgMessages;
  }

  async getRecentMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    const hasRedis = await this.redisBuffer.hasSession(sessionId);
    if (hasRedis) {
      return this.redisBuffer.getRecentMessages(sessionId, count);
    }
    return this.pgStore.getRecentMessages(sessionId, count);
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    return this.redisBuffer.getSessionMeta(sessionId);
  }

  async saveSessionMeta(meta: SessionMeta): Promise<void> {
    await this.redisBuffer.saveSessionMeta(meta);
  }

  async updateLastActivity(sessionId: string): Promise<void> {
    await this.redisBuffer.updateLastActivity(sessionId);
  }

  async shouldCompress(sessionId: string): Promise<boolean> {
    const cfg = getConfig().instance.memory;
    const count = await this.redisBuffer.getMessageCount(sessionId);
    return count > cfg.compressionThreshold;
  }

  async compressSession(
    sessionId: string,
    compressFn: (messages: StoredMessage[]) => Promise<string>,
  ): Promise<void> {
    const cfg = getConfig().instance.memory;
    const messages = await this.redisBuffer.getMessages(sessionId);

    if (messages.length <= cfg.compressionThreshold) return;

    const toCompress = messages.slice(0, -cfg.compressionKeepRecent);
    const toKeep = messages.slice(-cfg.compressionKeepRecent);

    const summary = await compressFn(toCompress);

    // Create a summary message
    const summaryMessage: StoredMessage = {
      id: `summary-${sessionId}-${Date.now()}`,
      sessionId,
      channelName: toKeep[0]?.channelName ?? 'unknown',
      senderType: 'agent',
      senderId: 'system',
      content: {
        type: 'summary',
        summary,
        text: summary,
        compressedCount: toCompress.length,
      },
      createdAt: new Date(),
    };

    const newMessages = [summaryMessage, ...toKeep];
    await this.redisBuffer.replaceMessages(sessionId, newMessages);

    // Update meta
    const meta = await this.redisBuffer.getSessionMeta(sessionId);
    if (meta) {
      meta.compressed = true;
      meta.compressionSummary = summary;
      await this.redisBuffer.saveSessionMeta(meta);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redisBuffer.deleteSession(sessionId);
  }
}
