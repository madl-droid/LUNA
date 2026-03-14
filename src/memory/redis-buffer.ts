import type { Redis } from 'ioredis';
import type { StoredMessage, SessionMeta } from './types.js';
import { getConfig } from '../config.js';

export class RedisBuffer {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    const cfg = getConfig().instance.memory;
    const key = this.messagesKey(message.sessionId);

    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.ltrim(key, -cfg.bufferMessageCount, -1);
    await this.refreshTTL(message.sessionId);
  }

  async getMessages(sessionId: string): Promise<StoredMessage[]> {
    const key = this.messagesKey(sessionId);
    const raw = await this.redis.lrange(key, 0, -1);
    return raw.map((r) => this.deserializeMessage(r));
  }

  async getRecentMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    const key = this.messagesKey(sessionId);
    const raw = await this.redis.lrange(key, -count, -1);
    return raw.map((r) => this.deserializeMessage(r));
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return this.redis.llen(this.messagesKey(sessionId));
  }

  async saveSessionMeta(meta: SessionMeta): Promise<void> {
    const key = this.metaKey(meta.sessionId);
    await this.redis.hset(key, {
      sessionId: meta.sessionId,
      contactId: meta.contactId,
      channelName: meta.channelName,
      startedAt: meta.startedAt.toISOString(),
      lastActivityAt: meta.lastActivityAt.toISOString(),
      messageCount: String(meta.messageCount),
      compressed: String(meta.compressed),
      compressionSummary: meta.compressionSummary ?? '',
    });
    await this.refreshTTL(meta.sessionId);
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const key = this.metaKey(sessionId);
    const data = await this.redis.hgetall(key);
    if (!data['sessionId']) return null;

    return {
      sessionId: data['sessionId']!,
      contactId: data['contactId']!,
      channelName: data['channelName']!,
      startedAt: new Date(data['startedAt']!),
      lastActivityAt: new Date(data['lastActivityAt']!),
      messageCount: Number(data['messageCount']),
      compressed: data['compressed'] === 'true',
      compressionSummary: data['compressionSummary'] || undefined,
    };
  }

  async updateLastActivity(sessionId: string): Promise<void> {
    const key = this.metaKey(sessionId);
    await this.redis.hset(key, 'lastActivityAt', new Date().toISOString());
    await this.refreshTTL(sessionId);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.metaKey(sessionId))) === 1;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.messagesKey(sessionId), this.metaKey(sessionId));
  }

  async replaceMessages(sessionId: string, messages: StoredMessage[]): Promise<void> {
    const key = this.messagesKey(sessionId);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    for (const msg of messages) {
      pipeline.rpush(key, JSON.stringify(msg));
    }
    await pipeline.exec();
    await this.refreshTTL(sessionId);
  }

  private async refreshTTL(sessionId: string): Promise<void> {
    const ttlSeconds = getConfig().instance.memory.sessionMaxTTLHours * 3600;
    await this.redis.expire(this.messagesKey(sessionId), ttlSeconds);
    await this.redis.expire(this.metaKey(sessionId), ttlSeconds);
  }

  private messagesKey(sessionId: string): string {
    return `session:${sessionId}:messages`;
  }

  private metaKey(sessionId: string): string {
    return `session:${sessionId}:meta`;
  }

  private deserializeMessage(raw: string): StoredMessage {
    const parsed = JSON.parse(raw) as StoredMessage & { createdAt: string };
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
    };
  }
}
