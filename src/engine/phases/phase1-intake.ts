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
import { determineResponseFormat } from '../utils/response-format-detector.js'
import { recordInputType } from '../utils/audio-preference.js'
import { processAttachments, buildFallbackMessages } from '../attachments/processor.js'
import type { ChannelAttachmentConfig, AttachmentEngineConfig } from '../attachments/types.js'
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

  // 5b. Classify attachments (metadata for evaluator context)
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
    message.threadId,
  )

  // 11b. Launch attachment processing in parallel (now that session.id is available)
  const attachmentProcessingPromise = (config.attachmentEnabled && message.attachments?.length)
    ? processAttachmentsInPhase1(message, config, registry, db, redis, session.id)
    : Promise.resolve(null)

  // 11c. Detect campaign (needs session for round number)
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
    contact?.id && memoryManager && normalizedText ? memoryManager.hybridSearch(contact.id, normalizedText, 'es', getContextSummariesLimit(registry, message.channelName)) : Promise.resolve([]),
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

  // 16. Await attachment processing (ran in parallel with steps 6-15)
  // Inject processed attachments as labeled messages in history so evaluator sees content directly
  let attachmentContext: import('../attachments/types.js').AttachmentContext | null = null
  const attachmentFallbackMessages: string[] = []

  try {
    const attResult = await attachmentProcessingPromise
    if (attResult) {
      attachmentContext = attResult
      attachmentFallbackMessages.push(...attResult.fallbackMessages)

      // Inject each processed attachment as a "message" in history with [Category] label
      for (const att of attResult.attachments) {
        // Unsupported by channel: notify evaluator so it knows what the user tried to send
        if (att.status === 'disabled_by_channel') {
          history.push({
            role: 'user',
            content: `[Adjunto no soportado] El usuario envió ${att.filename} (${att.categoryLabel}) pero este canal no permite procesar ${att.categoryLabel.toLowerCase()}.`,
            timestamp: new Date(),
          })
          continue
        }

        // Knowledge match: document already indexed — tell evaluator
        if (att.status === 'knowledge_match') {
          history.push({
            role: 'user',
            content: `[Documento conocido] El usuario envió "${att.filename}" que ya está en la base de conocimiento. ${att.summary ?? ''} Puedes consultar la base de conocimiento para más detalle.`,
            timestamp: new Date(),
          })
          continue
        }

        if (att.status !== 'processed' || !att.extractedText) continue

        let injectedContent: string
        if (att.sizeTier === 'large' && att.llmText) {
          // Large file: inject category label + LLM description
          injectedContent = `[${att.categoryLabel}] ${att.filename} — Descripción: ${att.llmText}`
        } else if (att.llmText && (att.category === 'images' || att.category === 'audio' || att.category === 'video')) {
          // Multimedia: inject category label + LLM content (vision/transcription/multimodal)
          injectedContent = `[${att.categoryLabel}] ${att.llmText}`
        } else {
          // Small/medium text file: inject category label + full extracted content
          injectedContent = `[${att.categoryLabel}] ${att.extractedText}`
        }

        history.push({
          role: 'user',
          content: injectedContent,
          timestamp: new Date(),
        })
      }

      // Inject URL extractions too
      for (const url of attResult.urls) {
        if (url.status !== 'processed' || !url.extractedText) continue
        history.push({
          role: 'user',
          content: `[web_link] ${url.title ?? url.url}: ${url.extractedText}`,
          timestamp: new Date(),
        })
      }
    }
  } catch (err) {
    logger.warn({ err, traceId }, 'Attachment processing in Phase 1 failed — evaluator will see metadata only')
  }

  // Load HITL pending context (if hitl module is active)
  let hitlPendingContext: string | null = null
  try {
    const hitlCtx = registry.getOptional<{ getPending(channel: string, senderId: string): Promise<string | null> }>('hitl:context')
    if (hitlCtx) {
      hitlPendingContext = await hitlCtx.getPending(message.channelName, message.from)
    }
  } catch { /* hitl module not active */ }

  // Record input type for audio preference learning (fire-and-forget)
  if (contact?.id) {
    recordInputType(redis, contact.id, messageType).catch(() => {})
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId, durationMs, userType,
    hasContact: !!contact, sessionIsNew: session.isNew,
    memoryLoaded: !!contactMemory,
    commitments: pendingCommitments.length,
    summaries: relevantSummaries.length,
    attachments: attachmentMeta.length,
    hitlPending: !!hitlPendingContext,
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
    attachmentContext, // populated here in Phase 1 (parallel with context loading)
    responseFormat: (() => {
      const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${message.channelName}`)
      const chType = channelSvc?.get()?.channelType ?? 'async'
      return determineResponseFormat(normalizedText, messageType, message.channelName, chType)
    })(),
    possibleInjection,
    hitlPendingContext,
  }
}

// ─── Attachment processing in Phase 1 ──────

/** Default attachment config when no channel-specific config exists */
const DEFAULT_ATTACHMENT_CONFIG: ChannelAttachmentConfig = {
  enabledCategories: ['documents', 'images', 'text'],
  maxFileSizeMb: 25,
  maxAttachmentsPerMessage: 10,
}

/**
 * Process attachments in Phase 1 (parallel with context loading).
 * Downloads, extracts, enriches with LLM, and returns AttachmentContext.
 * Results are then injected as history messages so the evaluator sees content directly.
 */
async function processAttachmentsInPhase1(
  message: IncomingMessage,
  config: EngineConfig,
  registry: Registry,
  db: Pool,
  redis: Redis,
  sessionId: string,
): Promise<import('../attachments/types.js').AttachmentContext | null> {
  if (!message.attachments?.length) return null

  // Resolve channel attachment config
  const channelSvc = registry.getOptional<{ get(): { attachments?: ChannelAttachmentConfig } }>(`channel-config:${message.channelName}`)
  const channelAttConfig = channelSvc?.get()?.attachments ?? DEFAULT_ATTACHMENT_CONFIG

  // Resolve engine attachment config
  const engineAttSvc = registry.getOptional<{ get(): AttachmentEngineConfig }>('engine:attachment-config')
  const attEngineConfig: AttachmentEngineConfig = engineAttSvc?.get() ?? {
    enabled: config.attachmentEnabled,
    smallDocTokens: config.attachmentSmallDocTokens,
    mediumDocTokens: config.attachmentMediumDocTokens,
    summaryMaxTokens: config.attachmentSummaryMaxTokens,
    cacheTtlMs: config.attachmentCacheTtlMs,
    urlFetchTimeoutMs: config.attachmentUrlFetchTimeoutMs,
    urlMaxSizeMb: config.attachmentUrlMaxSizeMb,
    urlEnabled: config.attachmentUrlEnabled,
  }

  if (!attEngineConfig.enabled) return null

  const attachmentContext = await processAttachments(
    message.attachments,
    message.content.text ?? '',
    channelAttConfig,
    attEngineConfig,
    message.channelName,
    sessionId,
    message.id,
    registry,
    db,
    redis,
  )

  const fallbacks = buildFallbackMessages(attachmentContext.attachments, channelAttConfig)
  attachmentContext.fallbackMessages.push(...fallbacks)

  return attachmentContext
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
  threadId?: string,
): Promise<SessionInfo> {
  const cutoff = new Date(Date.now() - reopenWindowMs)

  // For channels that provide a threadId (Gmail), look up session by thread first.
  // This ensures all emails in the same thread share one session, regardless of timing.
  if (threadId) {
    try {
      const result = await db.query(
        `SELECT s.id, s.contact_id, s.agent_id, s.channel_name, s.started_at, s.last_activity_at,
                s.message_count, ss.summary_text AS compressed_summary
         FROM sessions s
         LEFT JOIN LATERAL (
           SELECT summary_text FROM session_summaries
           WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
         ) ss ON true
         WHERE s.thread_id = $1 AND s.last_activity_at > $2
         ORDER BY s.last_activity_at DESC
         LIMIT 1`,
        [threadId, cutoff],
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
      logger.warn({ err, threadId, channel }, 'Failed to load session by thread_id')
    }
  } else if (contactId) {
    // Standard lookup: most recent session for this contact within the reopen window
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
      `INSERT INTO sessions (id, contact_id, channel_contact_id, channel_name, agent_id, started_at, last_activity_at, message_count, thread_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7)`,
      [sessionId, contactId, channelContactId, channel, agentId, now, threadId ?? null],
    )
  } catch (err) {
    logger.error({ err, sessionId, channelContactId, channel, threadId }, 'Failed to create session in DB — cannot proceed without persisted session')
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

function getContextSummariesLimit(registry: Registry, channel: string): number {
  const channelType = registry.getOptional<{ get(): { channelType: string } }>(`channel-config:${channel}`)?.get()?.channelType ?? 'instant'
  const svc = registry.getOptional<{ get(): { instant: number; async: number; voice: number } }>('memory:context-summaries')
  const limits = svc?.get()
  if (!limits) return 3
  if (channelType === 'async') return limits.async
  if (channelType === 'voice') return limits.voice
  return limits.instant
}

