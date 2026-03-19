// LUNA Engine — Phase 1: Intake + Context Loading
// Código puro, sin LLM. Target: <200ms.
// Normaliza, resuelve usuario, carga contexto, detecta quick actions.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { IncomingMessage } from '../../channels/types.js'
import type {
  ContextBundle,
  ContactInfo,
  SessionInfo,
  HistoryMessage,
  EngineConfig,
  UserType,
  UserPermissions,
  CampaignInfo,
} from '../types.js'
import { normalizeText, detectMessageType } from '../utils/normalizer.js'
import { detectInputInjection } from '../utils/injection-detector.js'
import { detectQuickAction } from '../utils/quick-actions.js'
import { searchKnowledge } from '../utils/rag-local.js'
import { resolveUserType, getUserPermissions } from '../mocks/user-resolver.js'

const logger = pino({ name: 'engine:phase1' })

/**
 * Execute Phase 1: Intake + Context Loading.
 * Returns a fully populated ContextBundle.
 */
export async function phase1Intake(
  message: IncomingMessage,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): Promise<ContextBundle> {
  const traceId = randomUUID()
  const startMs = Date.now()

  logger.info({ traceId, from: message.from, channel: message.channelName }, 'Phase 1 start')

  // 1. Normalize message text
  const normalizedText = normalizeText(message.content.text)
  const messageType = detectMessageType(message.content)

  // 2. Resolve user type (FIRST — before anything else)
  //    Check Redis cache first
  const { userType, userPermissions } = await resolveUserWithCache(
    message.from,
    message.channelName,
    redis,
    config.userTypeCacheTtlSeconds,
  )

  // 3. Quick actions (regex: stop, escalate, yes/no)
  const quickAction = detectQuickAction(normalizedText)

  // 4. Detect possible prompt injection
  const possibleInjection = detectInputInjection(normalizedText)

  // 5. Identify contact (query DB)
  const contact = await findContact(db, message.from, message.channelName)

  // 6. Load or create session
  const session = await loadOrCreateSession(
    db,
    contact?.id ?? null,
    message.from,
    message.channelName,
    config.sessionReopenWindowMs,
  )

  // 7. Detect campaign (by destination number, keyword, UTM)
  const campaign = await detectCampaign(db, message, normalizedText)

  // 8. RAG local (fuse.js against instance/knowledge/)
  const knowledgeMatches = normalizedText
    ? await searchKnowledge(normalizedText, config.knowledgeDir, 3)
    : []

  // 9. Load history (last 10 messages)
  const history = await loadHistory(db, session.id, 10)

  // 10. Load sheets cache from Redis
  const sheetsData = await loadSheetsCache(redis)

  const durationMs = Date.now() - startMs
  logger.info({ traceId, durationMs, userType, hasContact: !!contact, sessionIsNew: session.isNew }, 'Phase 1 complete')

  return {
    message,
    traceId,
    userType,
    userPermissions,
    contactId: contact?.id ?? null,
    contact,
    session,
    isNewContact: !contact,
    quickAction,
    campaign,
    knowledgeMatches,
    history,
    sheetsData,
    normalizedText,
    messageType,
    possibleInjection,
  }
}

// ─── Helpers ──────────────────────────────

/**
 * Resolve user type with Redis cache.
 */
async function resolveUserWithCache(
  senderId: string,
  channel: string,
  redis: Redis,
  ttlSeconds: number,
): Promise<{ userType: UserType; userPermissions: UserPermissions }> {
  const cacheKey = `user_type:${senderId}:${channel}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as { userType: UserType; userPermissions: UserPermissions }
      return parsed
    }
  } catch (err) {
    logger.warn({ err, senderId }, 'Redis cache read failed for user type')
  }

  // Not cached — resolve via S02 mock
  const resolution = await resolveUserType(senderId, channel)
  const permissions = await getUserPermissions(resolution.userType)

  const result = { userType: resolution.userType, userPermissions: permissions }

  // Cache in Redis
  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds)
  } catch (err) {
    logger.warn({ err, senderId }, 'Redis cache write failed for user type')
  }

  return result
}

/**
 * Find contact by channel-specific ID.
 */
async function findContact(
  db: Pool,
  channelContactId: string,
  channel: string,
): Promise<ContactInfo | null> {
  try {
    const result = await db.query(
      `SELECT c.id, c.display_name, c.contact_type, c.qualification_status,
              c.qualification_score, c.qualification_data, c.created_at,
              cc.channel_contact_id, cc.channel_name
       FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_contact_id = $1 AND cc.channel_name = $2
       LIMIT 1`,
      [channelContactId, channel],
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      channelContactId: row.channel_contact_id,
      channel: row.channel_name,
      displayName: row.display_name,
      contactType: row.contact_type,
      qualificationStatus: row.qualification_status,
      qualificationScore: row.qualification_score,
      qualificationData: row.qualification_data,
      createdAt: row.created_at,
    }
  } catch (err) {
    logger.warn({ err, channelContactId, channel }, 'Failed to find contact')
    return null
  }
}

/**
 * Load existing session or create a new one.
 * Reopens if last activity was <24h ago.
 */
async function loadOrCreateSession(
  db: Pool,
  contactId: string | null,
  channelContactId: string,
  channel: string,
  reopenWindowMs: number,
): Promise<SessionInfo> {
  const cutoff = new Date(Date.now() - reopenWindowMs)

  if (contactId) {
    try {
      const result = await db.query(
        `SELECT id, contact_id, channel_name, started_at, last_activity_at,
                message_count, compressed_summary
         FROM sessions
         WHERE contact_id = $1 AND channel_name = $2 AND last_activity_at > $3
         ORDER BY last_activity_at DESC
         LIMIT 1`,
        [contactId, channel, cutoff],
      )

      if (result.rows.length > 0) {
        const row = result.rows[0]
        return {
          id: row.id,
          contactId: row.contact_id,
          channel: row.channel_name,
          startedAt: row.started_at,
          lastActivityAt: row.last_activity_at,
          messageCount: row.message_count,
          compressedSummary: row.compressed_summary,
          isNew: false,
        }
      }
    } catch (err) {
      logger.warn({ err, contactId, channel }, 'Failed to load session')
    }
  }

  // Create new session
  const sessionId = randomUUID()
  const now = new Date()

  try {
    await db.query(
      `INSERT INTO sessions (id, contact_id, channel_contact_id, channel_name, started_at, last_activity_at, message_count)
       VALUES ($1, $2, $3, $4, $5, $5, 0)`,
      [sessionId, contactId, channelContactId, channel, now],
    )
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to create session in DB (table may not exist yet)')
  }

  return {
    id: sessionId,
    contactId: contactId ?? channelContactId,
    channel: channel as ContactInfo['channel'],
    startedAt: now,
    lastActivityAt: now,
    messageCount: 0,
    compressedSummary: null,
    isNew: true,
  }
}

/**
 * Detect campaign from message metadata.
 */
async function detectCampaign(
  db: Pool,
  _message: IncomingMessage,
  _normalizedText: string,
): Promise<CampaignInfo | null> {
  // TODO: implement campaign detection by destination number, keyword, UTM
  // For now, return null (no campaign detection)
  return null
}

/**
 * Load conversation history from DB.
 */
async function loadHistory(
  db: Pool,
  sessionId: string,
  limit: number,
): Promise<HistoryMessage[]> {
  try {
    const result = await db.query(
      `SELECT sender_type, content, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit],
    )

    return result.rows.reverse().map((row: Record<string, unknown>) => ({
      role: row.sender_type === 'agent' ? 'assistant' as const : 'user' as const,
      content: typeof row.content === 'object' ? ((row.content as Record<string, string>)?.text ?? '') : String(row.content),
      timestamp: row.created_at as Date,
    }))
  } catch (err) {
    logger.debug({ err, sessionId }, 'Failed to load history (table may not exist yet)')
    return []
  }
}

/**
 * Load sheets data cache from Redis.
 */
async function loadSheetsCache(redis: Redis): Promise<Record<string, unknown> | null> {
  try {
    const cached = await redis.get('sheets:cache')
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}
