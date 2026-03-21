// LUNA Engine — Phase 1: Intake + Context Loading (v3)
// Código puro, sin LLM. Target: <200ms.
// Normaliza, resuelve usuario, carga contexto (memory:manager), detecta quick actions.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
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
  KnowledgeInjection,
} from '../types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { ContactMemory } from '../../modules/memory/types.js'
import { normalizeText, detectMessageType } from '../utils/normalizer.js'
import { detectInputInjection } from '../utils/injection-detector.js'
import { detectQuickAction } from '../utils/quick-actions.js'
import { searchKnowledge } from '../utils/rag-local.js'
import { resolveUserType, getUserPermissions } from '../mocks/user-resolver.js'

const logger = pino({ name: 'engine:phase1' })

const DEFAULT_AGENT_ID = 'luna'

/**
 * Execute Phase 1: Intake + Context Loading.
 * Returns a fully populated ContextBundle.
 */
export async function phase1Intake(
  message: IncomingMessage,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
  registry: Registry,
): Promise<ContextBundle> {
  const traceId = randomUUID()
  const startMs = Date.now()

  logger.info({ traceId, from: message.from, channel: message.channelName }, 'Phase 1 start')

  // Resolve memory:manager (optional — graceful degradation)
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null

  // 1. Normalize message text
  const normalizedText = normalizeText(message.content.text)
  const messageType = detectMessageType(message.content)

  // 2. Resolve user type (FIRST — before anything else)
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

  // 5. Resolve agent ID
  const agentId = await resolveAgentId(memoryManager)

  // 6-10. Load context in parallel (graceful degradation)
  // Knowledge v2: try knowledge:manager.getInjection() first, fallback to rag-local
  const knowledgeManagerSvc = registry.getOptional<{ getInjection(): Promise<KnowledgeInjection> }>('knowledge:manager')

  const [
    contactResult,
    campaignResult,
    knowledgeResult,
    knowledgeInjectionResult,
    sheetsCacheResult,
  ] = await Promise.allSettled([
    findContact(db, message.from, message.channelName),
    detectCampaign(db, message, normalizedText),
    // Fallback RAG — only if knowledge module not active
    !knowledgeManagerSvc && normalizedText
      ? searchKnowledge(normalizedText, config.knowledgeDir, 3)
      : Promise.resolve([]),
    // Knowledge v2 injection
    knowledgeManagerSvc
      ? knowledgeManagerSvc.getInjection()
      : Promise.resolve(null),
    loadSheetsCache(redis),
  ])

  const contact = contactResult.status === 'fulfilled' ? contactResult.value : null
  const campaign = campaignResult.status === 'fulfilled' ? campaignResult.value : null
  const knowledgeMatches = knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : []
  const knowledgeInjection = knowledgeInjectionResult.status === 'fulfilled' ? knowledgeInjectionResult.value : null
  const sheetsData = sheetsCacheResult.status === 'fulfilled' ? sheetsCacheResult.value : null

  if (contactResult.status === 'rejected') logger.warn({ err: contactResult.reason, traceId }, 'Contact lookup failed')

  // 11. Load or create session
  const session = await loadOrCreateSession(
    db,
    contact?.id ?? null,
    message.from,
    message.channelName,
    agentId,
    config.sessionReopenWindowMs,
  )

  // 12-15. Load memory context in parallel
  const [
    historyResult,
    memoryResult,
    commitmentsResult,
    summariesResult,
    leadStatusResult,
  ] = await Promise.allSettled([
    loadHistory(memoryManager, db, session.id, 10),
    contact?.id && memoryManager ? loadContactMemory(memoryManager, agentId, contact.id) : Promise.resolve(null),
    contact?.id && memoryManager ? memoryManager.getPendingCommitments(agentId, contact.id) : Promise.resolve([]),
    contact?.id && memoryManager && normalizedText ? memoryManager.hybridSearch(contact.id, normalizedText, 'es', 3) : Promise.resolve([]),
    contact?.id && memoryManager ? memoryManager.getLeadStatus(contact.id, agentId) : Promise.resolve(null),
  ])

  const history = historyResult.status === 'fulfilled' ? historyResult.value : []
  const contactMemory = memoryResult.status === 'fulfilled' ? memoryResult.value : null
  const pendingCommitments = commitmentsResult.status === 'fulfilled' ? commitmentsResult.value : []
  const relevantSummaries = summariesResult.status === 'fulfilled' ? summariesResult.value : []
  const leadStatus = leadStatusResult.status === 'fulfilled' ? leadStatusResult.value : null

  // Invalidate context cache (new message = new context)
  if (contact?.id && memoryManager) {
    memoryManager.invalidateContext(contact.id, agentId).catch(() => {})
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId, durationMs, userType,
    hasContact: !!contact, sessionIsNew: session.isNew,
    memoryLoaded: !!contactMemory,
    commitments: pendingCommitments.length,
    summaries: relevantSummaries.length,
  }, 'Phase 1 complete')

  return {
    message,
    traceId,
    userType,
    userPermissions,
    contactId: contact?.id ?? null,
    agentId,
    contact,
    session,
    isNewContact: !contact,
    quickAction,
    campaign,
    knowledgeMatches,
    knowledgeInjection,
    history,
    contactMemory,
    pendingCommitments,
    relevantSummaries,
    leadStatus,
    sheetsData,
    normalizedText,
    messageType,
    possibleInjection,
  }
}

// ─── Helpers ──────────────────────────────

async function resolveAgentId(memoryManager: MemoryManager | null): Promise<string> {
  if (!memoryManager) return DEFAULT_AGENT_ID
  try {
    const id = await memoryManager.resolveAgentId(DEFAULT_AGENT_ID)
    return id ?? DEFAULT_AGENT_ID
  } catch {
    return DEFAULT_AGENT_ID
  }
}

async function loadContactMemory(
  memoryManager: MemoryManager,
  agentId: string,
  contactId: string,
): Promise<ContactMemory | null> {
  try {
    const ac = await memoryManager.getAgentContact(agentId, contactId)
    return ac?.contactMemory ?? null
  } catch (err) {
    logger.warn({ err, agentId, contactId }, 'Failed to load contact memory')
    return null
  }
}

async function loadHistory(
  memoryManager: MemoryManager | null,
  db: Pool,
  sessionId: string,
  limit: number,
): Promise<HistoryMessage[]> {
  if (memoryManager) {
    try {
      const messages = await memoryManager.getSessionMessages(sessionId)
      return messages.slice(-limit).map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.contentText || m.content?.text || '',
        timestamp: m.createdAt,
      }))
    } catch (err) {
      logger.warn({ err, sessionId }, 'memory:manager getSessionMessages failed, falling back to direct DB')
    }
  }

  return await loadHistoryFromDb(db, sessionId, limit)
}

async function loadHistoryFromDb(
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
      return JSON.parse(cached) as { userType: UserType; userPermissions: UserPermissions }
    }
  } catch (err) {
    logger.warn({ err, senderId }, 'Redis cache read failed for user type')
  }

  const resolution = await resolveUserType(senderId, channel)
  const permissions = await getUserPermissions(resolution.userType)
  const result = { userType: resolution.userType, userPermissions: permissions }

  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds)
  } catch (err) {
    logger.warn({ err, senderId }, 'Redis cache write failed for user type')
  }

  return result
}

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

async function loadOrCreateSession(
  db: Pool,
  contactId: string | null,
  channelContactId: string,
  channel: string,
  agentId: string,
  reopenWindowMs: number,
): Promise<SessionInfo> {
  const cutoff = new Date(Date.now() - reopenWindowMs)

  if (contactId) {
    try {
      const result = await db.query(
        `SELECT id, contact_id, agent_id, channel_name, started_at, last_activity_at,
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
          agentId: row.agent_id ?? agentId,
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

  const sessionId = randomUUID()
  const now = new Date()

  try {
    await db.query(
      `INSERT INTO sessions (id, contact_id, channel_contact_id, channel_name, agent_id, started_at, last_activity_at, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 0)`,
      [sessionId, contactId, channelContactId, channel, agentId, now],
    )
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to create session in DB (table may not exist yet)')
  }

  return {
    id: sessionId,
    contactId: contactId ?? channelContactId,
    agentId,
    channel: channel as ContactInfo['channel'],
    startedAt: now,
    lastActivityAt: now,
    messageCount: 0,
    compressedSummary: null,
    isNew: true,
  }
}

async function detectCampaign(
  _db: Pool,
  _message: IncomingMessage,
  _normalizedText: string,
): Promise<CampaignInfo | null> {
  return null
}

async function loadSheetsCache(redis: Redis): Promise<Record<string, unknown> | null> {
  try {
    const cached = await redis.get('sheets:cache')
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}
