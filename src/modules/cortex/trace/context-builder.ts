// cortex/trace/context-builder.ts — Builds ContextBundle for simulation
// Reads real DB data (read-only) when contactRef is provided,
// otherwise builds synthetic context. NEVER writes to DB.

import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Registry } from '../../../kernel/registry.js'
import type { IncomingMessage, ChannelName } from '../../../channels/types.js'
import type {
  ContextBundle, HistoryMessage, UserType, UserPermissions,
  ContactInfo, SessionInfo, ToolCatalogEntry,
} from '../../../engine/types.js'
import type { ScenarioMessage } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:context' })

/** Full permissions for simulation (no restrictions) */
const SIM_PERMISSIONS: UserPermissions = {
  tools: [],
  skills: [],
  subagents: true,
  canReceiveProactive: false,
  knowledgeCategories: [],
}

/**
 * Build a ContextBundle for one simulated message.
 * If contactRef is set, loads real contact data (read-only).
 * Otherwise creates minimal synthetic context.
 */
export async function buildSimContext(
  db: Pool,
  registry: Registry,
  message: ScenarioMessage,
  previousHistory?: HistoryMessage[],
): Promise<{ ctx: ContextBundle; toolCatalog: ToolCatalogEntry[] }> {
  const traceId = `sim-${crypto.randomUUID()}`
  const userType: UserType = message.userType ?? 'lead'

  // Build the IncomingMessage
  const incoming: IncomingMessage = {
    id: crypto.randomUUID(),
    channelName: message.channel,
    channelMessageId: '',
    from: `sim:${crypto.randomUUID()}`,
    senderName: message.senderName ?? 'Sim Contact',
    timestamp: new Date(),
    content: { type: 'text', text: message.text },
  }

  // Load contact data from DB if contactRef provided
  let contact: ContactInfo | null = null
  let session: SessionInfo
  let history: HistoryMessage[] = []
  let contactMemory: ContextBundle['contactMemory'] = null
  let pendingCommitments: ContextBundle['pendingCommitments'] = []
  let relevantSummaries: ContextBundle['relevantSummaries'] = []
  let leadStatus: string | null = null

  if (message.contactRef) {
    try {
      const contactData = await loadContactData(db, message.contactRef)
      if (contactData) {
        contact = contactData.contact
        history = contactData.history
        contactMemory = contactData.contactMemory
        leadStatus = contactData.leadStatus
      }
    } catch (err) {
      logger.warn({ err, contactRef: message.contactRef }, 'Failed to load contact data for simulation')
    }
  }

  // Override history if provided explicitly
  if (message.history) {
    history = message.history
  } else if (previousHistory && previousHistory.length > 0) {
    history = previousHistory
  }

  // Build session (always synthetic — never touches real sessions)
  session = {
    id: crypto.randomUUID(),
    contactId: contact?.id ?? crypto.randomUUID(),
    channel: message.channel,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    messageCount: history.length,
    compressedSummary: null,
    isNew: !contact,
  }

  // Load knowledge injection if available
  let knowledgeInjection: ContextBundle['knowledgeInjection'] = null
  try {
    const knowledgeSvc = registry.getOptional<{ getInjection?: () => unknown }>('knowledge:manager')
    if (knowledgeSvc?.getInjection) {
      knowledgeInjection = knowledgeSvc.getInjection() as ContextBundle['knowledgeInjection']
    }
  } catch { /* best effort */ }

  // Load tool catalog
  let toolCatalog: ToolCatalogEntry[] = []
  try {
    const toolsReg = registry.getOptional<{ getCatalog?: () => ToolCatalogEntry[] }>('tools:registry')
    if (toolsReg?.getCatalog) {
      toolCatalog = toolsReg.getCatalog()
    }
  } catch { /* best effort */ }

  const ctx: ContextBundle = {
    message: incoming,
    traceId,
    userType,
    userPermissions: SIM_PERMISSIONS,
    contactId: contact?.id ?? null,
    contact,
    session,
    isNewContact: !contact,
    campaign: null,
    knowledgeMatches: [],
    knowledgeInjection,
    freshdeskMatches: [],
    assignmentRules: null,
    history,
    bufferSummary: null, // trace simulations don't load buffer summary
    contactMemory,
    pendingCommitments,
    relevantSummaries,
    leadStatus,
    sheetsData: null,
    normalizedText: message.text.trim(),
    messageType: 'text',
    responseFormat: 'text',
    attachmentMeta: [],
    attachmentContext: null,
    possibleInjection: false,
    hitlPendingContext: null,
  }

  return { ctx, toolCatalog }
}

// ─── Helpers ─────────────────────────────

interface ContactData {
  contact: ContactInfo
  history: HistoryMessage[]
  contactMemory: ContextBundle['contactMemory']
  leadStatus: string | null
}

async function loadContactData(db: Pool, contactId: string): Promise<ContactData | null> {
  // Load contact
  const { rows: contactRows } = await db.query(
    `SELECT c.id, cc.channel_contact_id, cc.channel, c.display_name, c.contact_type,
            ac.qualification_status, ac.qualification_score, ac.qualification_data,
            ac.contact_memory, ac.lead_status
     FROM contacts c
     LEFT JOIN contact_channels cc ON cc.contact_id = c.id
     LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
     WHERE c.id = $1
     LIMIT 1`,
    [contactId],
  )

  const row = contactRows[0] as Record<string, unknown> | undefined
  if (!row) return null

  const contact: ContactInfo = {
    id: row.id as string,
    channelContactId: (row.channel_contact_id as string) ?? '',
    channel: (row.channel as ChannelName) ?? 'whatsapp',
    displayName: (row.display_name as string) ?? null,
    contactType: (row.contact_type as string) ?? null,
    qualificationStatus: (row.qualification_status as string) ?? null,
    qualificationScore: (row.qualification_score as number) ?? null,
    qualificationData: (row.qualification_data as Record<string, unknown>) ?? null,
    createdAt: new Date(),
  }

  // Load recent history (last 10 messages from most recent session)
  const { rows: msgRows } = await db.query(
    `SELECT m.role, m.content_text, m.created_at
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.contact_id = $1
     ORDER BY m.created_at DESC LIMIT 10`,
    [contactId],
  )

  const history: HistoryMessage[] = msgRows
    .reverse()
    .map((m: Record<string, unknown>) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content_text as string,
      timestamp: m.created_at as Date,
    }))

  const contactMemory = (row.contact_memory as ContextBundle['contactMemory']) ?? null
  const leadStatus = (row.lead_status as string) ?? null

  return { contact, history, contactMemory, leadStatus }
}

