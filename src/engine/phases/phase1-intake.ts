// LUNA Engine — Phase 1: Intake + Context Loading (v4)
// Código puro, sin LLM. Target: <200ms.
// Normaliza, resuelve usuario via users:resolve, carga contexto (memory:manager).

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
  AttachmentMetadata,
  CampaignInfo,
  KnowledgeInjection,
} from '../types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { ContactMemory } from '../../modules/memory/types.js'
import { normalizeText, detectMessageType } from '../utils/normalizer.js'
import { detectInputInjection } from '../utils/injection-detector.js'
import { searchKnowledge } from '../utils/rag-local.js'
import { classifyAttachments } from '../attachments/classifier.js'
import { searchFreshdeskIndex } from '../../tools/freshdesk/freshdesk-rag.js'
import type { FreshdeskMatch } from '../../tools/freshdesk/types.js'

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

  // 2. Resolve user type via users:resolve service (FIRST — before anything else)
  // For WhatsApp LID: passes resolvedPhone as fallback so manually-saved contacts match
  // senderName: channel profile name (e.g. WhatsApp pushName) for auto-registration
  const { userType, userPermissions } = await resolveUser(
    message.from,
    message.channelName,
    registry,
    message.resolvedPhone,
    message.senderName,
  )

  // 3. Detect possible prompt injection
  const possibleInjection = detectInputInjection(normalizedText)

  // 5. Resolve agent ID
  const agentId = await resolveAgentId(memoryManager)

  // 5b. Classify attachments (metadata only — NO processing, NO downloads)
  // Heavy processing (transcription, extraction) moves to Phase 3 as 'process_attachment' steps
  const attachmentMeta: AttachmentMetadata[] = config.attachmentEnabled
    ? classifyAttachments(message)
    : []

  // 6-10. Load context in parallel (graceful degradation)
  // Knowledge v2: try knowledge:manager.getInjection() first, fallback to rag-local
  const knowledgeManagerSvc = registry.getOptional<{ getInjection(): Promise<KnowledgeInjection> }>('knowledge:manager')

  // Freshdesk KB metadata search (fuse.js over cached index) — runs in parallel
  const freshdeskPromise = normalizedText
    ? searchFreshdeskIndex(redis, normalizedText, 5).catch((): FreshdeskMatch[] => [])
    : Promise.resolve([] as FreshdeskMatch[])

  const [
    contactResult,
    knowledgeResult,
    knowledgeInjectionResult,
    sheetsCacheResult,
  ] = await Promise.allSettled([
    findContact(db, message.from, message.channelName, message.resolvedPhone),
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
  const knowledgeMatches = knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : []
  let knowledgeInjection = knowledgeInjectionResult.status === 'fulfilled' ? knowledgeInjectionResult.value : null
  const sheetsData = sheetsCacheResult.status === 'fulfilled' ? sheetsCacheResult.value : null
  const freshdeskMatches = await freshdeskPromise

  // Filter knowledge categories by user permissions (empty = all access)
  if (knowledgeInjection && userPermissions.knowledgeCategories.length > 0) {
    knowledgeInjection = {
      ...knowledgeInjection,
      categories: knowledgeInjection.categories.filter(
        c => userPermissions.knowledgeCategories.includes(c.id),
      ),
    }
  }

  // Load assignment rules for leads/unregistered (so LLM can classify contacts)
  let assignmentRules: Array<{ listType: string; listName: string; prompt: string }> | null = null
  if (userType === 'lead' || userType.startsWith('_unregistered:')) {
    try {
      const usersDb = registry.getOptional<import('../../modules/users/db.js').UsersDb>('users:db')
      if (usersDb) {
        const allConfigs = await usersDb.getAllListConfigs()
        const rules = allConfigs
          .filter(c => c.assignmentEnabled && c.assignmentPrompt)
          .map(c => ({ listType: c.listType, listName: c.displayName, prompt: c.assignmentPrompt }))
        if (rules.length > 0) assignmentRules = rules
      }
    } catch { /* users module not available */ }
  }

  if (contactResult.status === 'rejected') logger.warn({ err: contactResult.reason, traceId }, 'Contact lookup failed')

  // 11. Load or create session (channel-specific timeout if available)
  const sessionWindowMs = getChannelSessionTimeout(registry, message.channelName, config.sessionReopenWindowMs)
  const session = await loadOrCreateSession(
    db,
    contact?.id ?? null,
    message.from,
    message.channelName,
    agentId,
    sessionWindowMs,
  )

  // 11b. Detect campaign (needs session for round number)
  const detectedCampaign = detectCampaign(registry, normalizedText, message.channelName, session.messageCount)

  // 12-15. Load memory context in parallel
  const historyTurns = getChannelHistoryTurns(registry, message.channelName)
  const [
    historyResult,
    memoryResult,
    commitmentsResult,
    summariesResult,
    leadStatusResult,
    bufferSummaryResult,
  ] = await Promise.allSettled([
    loadHistory(memoryManager, db, session.id, historyTurns),
    contact?.id && memoryManager ? loadContactMemory(memoryManager, agentId, contact.id) : Promise.resolve(null),
    contact?.id && memoryManager ? memoryManager.getPendingCommitments(agentId, contact.id) : Promise.resolve([]),
    contact?.id && memoryManager && normalizedText ? memoryManager.hybridSearch(contact.id, normalizedText, 'es', 3) : Promise.resolve([]),
    contact?.id && memoryManager ? memoryManager.getLeadStatus(contact.id, agentId) : Promise.resolve(null),
    memoryManager ? memoryManager.getBufferSummary(session.id) : Promise.resolve(null),
  ])

  const history = historyResult.status === 'fulfilled' ? historyResult.value : []
  const contactMemory = memoryResult.status === 'fulfilled' ? memoryResult.value : null
  const pendingCommitments = commitmentsResult.status === 'fulfilled' ? commitmentsResult.value : []
  const relevantSummaries = summariesResult.status === 'fulfilled' ? summariesResult.value : []
  const leadStatus = leadStatusResult.status === 'fulfilled' ? leadStatusResult.value : null
  const bufferSummary = bufferSummaryResult.status === 'fulfilled' ? bufferSummaryResult.value : null

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
    attachments: attachmentMeta.length,
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
    campaign: detectedCampaign,
    knowledgeMatches,
    knowledgeInjection,
    freshdeskMatches,
    history,
    bufferSummary,
    contactMemory,
    pendingCommitments,
    relevantSummaries,
    leadStatus,
    sheetsData: sheetsData, // TODO(future): evaluar si sheets cache debe cargarse aquí o bajo demanda
    normalizedText,
    messageType,
    attachmentMeta,
    assignmentRules,
    attachmentContext: null, // populated by Phase 3 process_attachment steps
    responseFormat: messageType === 'audio' && message.channelName === 'whatsapp' ? 'audio' : 'text',
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
      `SELECT role, content_text, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit],
    )

    return result.rows.reverse().map((row: Record<string, unknown>) => ({
      role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: (row.content_text as string) ?? '',
      timestamp: row.created_at as Date,
    }))
  } catch (err) {
    logger.debug({ err, sessionId }, 'Failed to load history (table may not exist yet)')
    return []
  }
}

/** Default permissions when users module is not active */
const DEFAULT_LEAD_PERMISSIONS: UserPermissions = {
  tools: ['schedule', 'lookup_product'],
  skills: ['respond', 'schedule'],
  subagents: false,
  canReceiveProactive: true,
  knowledgeCategories: [],
}

/**
 * Resolve user type via users:resolve service from registry.
 * Falls back to 'lead' with basic permissions if users module is not active.
 * No caching here — the users module handles its own Redis cache.
 */
async function resolveUser(
  senderId: string,
  channel: string,
  registry: Registry,
  fallbackSenderId?: string,
  senderName?: string,
): Promise<{ userType: UserType; userPermissions: UserPermissions }> {
  // Try the real users module resolver
  const resolveFn = registry.getOptional<(senderId: string, channel: string, fallbackSenderId?: string, senderName?: string) => Promise<{ userType: string; listName?: string }>>(
    'users:resolve',
  )
  const permsFn = registry.getOptional<(userType: string) => Promise<UserPermissions>>(
    'users:permissions',
  )

  if (resolveFn) {
    try {
      const resolution = await resolveFn(senderId, channel, fallbackSenderId, senderName)
      const userType = resolution.userType as UserType
      const permissions = permsFn
        ? await permsFn(userType)
        : DEFAULT_LEAD_PERMISSIONS
      return { userType, userPermissions: permissions }
    } catch (err) {
      logger.warn({ err, senderId, channel }, 'users:resolve failed, falling back to lead')
    }
  } else {
    logger.debug('users:resolve not available — all contacts treated as leads')
  }

  // Fallback: everyone is a lead
  return { userType: 'lead', userPermissions: DEFAULT_LEAD_PERMISSIONS }
}

/**
 * Find a contact by channel identifier.
 * Supports fallback for WhatsApp LID migration:
 * - First tries the primary identifier (LID for WA)
 * - If not found and fallbackId provided (phone), tries that
 * - When found by fallback, auto-migrates channel_contact_id to LID
 * - Auto-creates a voice channel entry with the phone number for call linking
 */
async function findContact(
  db: Pool,
  channelContactId: string,
  channel: string,
  fallbackContactId?: string,
): Promise<ContactInfo | null> {
  const contactQuery = `SELECT c.id, c.display_name, c.contact_type,
              ac.lead_status AS qualification_status,
              COALESCE(ac.qualification_score, 0) AS qualification_score,
              COALESCE(ac.qualification_data, '{}') AS qualification_data,
              c.created_at,
              cc.channel_identifier, cc.channel_type, cc.id AS cc_id
       FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
         AND ac.agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)
       WHERE cc.channel_identifier = $1 AND cc.channel_type = $2
       LIMIT 1`

  try {
    let result = await db.query(contactQuery, [channelContactId, channel])

    // Fallback: try phone number (manually-created contacts use phone, not LID)
    if (result.rows.length === 0 && fallbackContactId) {
      result = await db.query(contactQuery, [fallbackContactId, channel])

      if (result.rows.length > 0) {
        const row = result.rows[0]!
        // Auto-migrate: update channel_identifier from phone to LID
        try {
          await db.query(
            `UPDATE contact_channels SET channel_identifier = $1 WHERE id = $2`,
            [channelContactId, row.cc_id],
          )
          logger.info({ contactId: row.id, oldId: fallbackContactId, newId: channelContactId, channel }, 'Auto-migrated contact_channels channel_identifier (phone → LID)')
        } catch (err) {
          logger.warn({ err, contactId: row.id }, 'Failed to auto-migrate contact_channels')
        }

        // Auto-create voice channel with the phone number (for call linking)
        await ensureVoiceChannel(db, row.id, fallbackContactId)
      }
    } else if (result.rows.length > 0 && fallbackContactId) {
      // Contact found by LID — still ensure voice channel exists
      await ensureVoiceChannel(db, result.rows[0]!.id, fallbackContactId)
    }

    if (result.rows.length === 0) return null

    const row = result.rows[0]!
    return {
      id: row.id,
      channelContactId: channelContactId, // always return the LID (current identifier)
      channel: row.channel_type,
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
 * Ensure a voice channel entry exists for a contact.
 * Creates one with the phone number if missing, so incoming calls
 * are automatically linked to the same contact as WhatsApp messages.
 */
async function ensureVoiceChannel(db: Pool, contactId: string, phoneNumber: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO contact_channels (contact_id, channel_type, channel_identifier, is_primary)
       VALUES ($1, 'voice', $2, false)
       ON CONFLICT (channel_type, channel_identifier) DO NOTHING`,
      [contactId, phoneNumber],
    )
  } catch (err) {
    logger.debug({ err, contactId, phoneNumber }, 'ensureVoiceChannel failed (may already exist)')
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
        `SELECT s.id, s.contact_id, s.agent_id, s.channel_name, s.started_at, s.last_activity_at,
                s.message_count, ss.summary_text AS compressed_summary
         FROM sessions s
         LEFT JOIN LATERAL (
           SELECT summary_text FROM session_summaries
           WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
         ) ss ON true
         WHERE s.contact_id = $1 AND s.channel_name = $2 AND s.last_activity_at > $3
         ORDER BY s.last_activity_at DESC
         LIMIT 1`,
        [contactId, channel, cutoff],
      )

      if (result.rows.length > 0) {
        const row = result.rows[0]!
        return {
          id: row.id,
          contactId: row.contact_id,
          agentId: row.agent_id ?? agentId,
          channel: row.channel_name,
          startedAt: row.started_at,
          lastActivityAt: row.last_activity_at,
          messageCount: row.message_count,
          compressedSummary: row.compressed_summary ?? null,
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
    logger.error({ err, sessionId, channelContactId, channel }, 'Failed to create session in DB — cannot proceed without persisted session')
    throw err
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

/**
 * Detect campaign via lead-scoring:match-campaign service.
 * Matches keyword against text with channel/round filtering.
 */
function detectCampaign(
  registry: Registry,
  normalizedText: string,
  channelName: string,
  sessionMessageCount: number,
): CampaignInfo | null {
  type MatchFn = (text: string, channelName: string, channelType: string, roundNumber: number) => {
    campaignId: string; visibleId: number; name: string; keyword: string; promptContext: string; score: number
  } | null

  const matchFn = registry.getOptional<MatchFn>('lead-scoring:match-campaign')
  if (!matchFn) return null

  // Get channel type from channel-config service
  const channelSvc = registry.getOptional<{ get(): { channelType: string } }>(`channel-config:${channelName}`)
  const channelType = channelSvc?.get()?.channelType ?? 'instant'

  // Round number: session.messageCount is the count BEFORE this message, so +1
  const roundNumber = sessionMessageCount + 1

  const result = matchFn(normalizedText, channelName, channelType, roundNumber)
  if (!result) return null

  return {
    id: result.campaignId,
    visibleId: result.visibleId,
    name: result.name,
    keyword: result.keyword,
    utm: null,
    promptContext: result.promptContext,
    matchScore: result.score,
  }
}

async function loadSheetsCache(redis: Redis): Promise<Record<string, unknown> | null> {
  try {
    const cached = await redis.get('sheets:cache')
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

/**
 * Get channel-specific session timeout from the channel config service.
 * Each channel module provides 'channel-config:{name}' with a sessionTimeoutMs field.
 * Falls back to engine default if the channel doesn't provide one.
 *
 * Pattern for new channels: provide 'channel-config:{channelName}' service
 * implementing ChannelRuntimeConfig (see src/channels/types.ts).
 */
function getChannelSessionTimeout(registry: Registry, channel: string, defaultMs: number): number {
  const svc = registry.getOptional<{ get(): { sessionTimeoutMs: number } }>(`channel-config:${channel}`)
  if (svc) {
    const timeout = svc.get().sessionTimeoutMs
    if (timeout > 0) return timeout
  }
  return defaultMs
}

/**
 * Get history turns for this channel from the channel config service.
 * Each channel reads its value from memory:buffer-turns (per category: instant/async/voice).
 * Falls back to 10 if channel config is not available.
 */
function getChannelHistoryTurns(registry: Registry, channel: string): number {
  const svc = registry.getOptional<{ get(): { historyTurns: number } }>(`channel-config:${channel}`)
  return svc?.get()?.historyTurns ?? 10
}

