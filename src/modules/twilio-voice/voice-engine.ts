// LUNA — Module: twilio-voice — Voice Engine
// Pipeline ligero para llamadas de voz. Delega la conversación a Gemini Live
// mientras LUNA provee contexto, tools y monitoreo.

import * as crypto from 'node:crypto'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { Pool } from 'pg'
import type { PromptsService } from '../prompts/types.js'
import type {
  TwilioVoiceConfig,
  PreloadedContext,
  GeminiToolDeclaration,
  CallDirection,
  TranscriptEntry,
} from './types.js'
import { getChannelLimit } from '../../engine/prompts/channel-format.js'

const logger = pino({ name: 'twilio-voice:engine' })

/**
 * Load context for a voice call. Called during answer delay for inbound,
 * or before dial for outbound. Similar to Phase 1 Intake but lighter.
 */
export async function preloadContext(
  registry: Registry,
  db: Pool,
  phoneNumber: string,
  direction: CallDirection,
  config: TwilioVoiceConfig,
  outboundReason?: string,
): Promise<PreloadedContext> {
  const startMs = Date.now()

  // Parallel context loading (similar to Phase 1 but minimal)
  const [contactResult, promptsResult, toolsResult] = await Promise.allSettled([
    loadContact(db, phoneNumber),
    loadPrompts(registry),
    loadTools(registry),
  ])

  const contact = contactResult.status === 'fulfilled' ? contactResult.value : null
  const prompts = promptsResult.status === 'fulfilled' ? promptsResult.value : null
  const tools = toolsResult.status === 'fulfilled' ? toolsResult.value : { tools: [], declarations: [] }

  // Load memory if contact exists
  let contactMemory: string | null = null
  let pendingCommitments: string[] = []
  let recentSummaries: string[] = []
  let contactChannels: Array<{ channel_type: string; channel_identifier: string; is_primary: boolean }> = []

  if (contact?.contactId) {
    const memResults = await Promise.allSettled([
      loadContactMemory(registry, contact.contactId),
      loadCommitments(registry, contact.contactId),
      loadSummaries(registry, contact.contactId),
      loadContactChannels(db, contact.contactId),
    ])

    contactMemory = memResults[0]!.status === 'fulfilled' ? memResults[0]!.value : null
    pendingCommitments = memResults[1]!.status === 'fulfilled' ? memResults[1]!.value : []
    recentSummaries = memResults[2]!.status === 'fulfilled' ? memResults[2]!.value : []
    contactChannels = memResults[3]!.status === 'fulfilled' ? memResults[3]!.value : []
  }

  // Build system instruction
  const greeting = direction === 'inbound'
    ? config.VOICE_GREETING_INBOUND
    : config.VOICE_GREETING_OUTBOUND

  const systemInstruction = await buildSystemInstruction(
    prompts,
    contact,
    contactMemory,
    pendingCommitments,
    recentSummaries,
    greeting,
    direction,
    config,
    registry,
    outboundReason,
    contactChannels,
  )

  // Add end-call tool to the declarations
  const endCallTool: GeminiToolDeclaration = {
    name: 'end_call',
    description: 'Termina la llamada actual de forma elegante. Solo usar cuando la conversaci\u00f3n ha terminado naturalmente, ambas partes se despidieron, y el caller confirm\u00f3 que no necesita nada m\u00e1s.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Raz\u00f3n del cierre. Ej: "despedida natural", "caller satisfecho"',
        },
      },
      required: ['reason'],
    },
  }

  const allDeclarations = [...tools.declarations, endCallTool]

  logger.info({ durationMs: Date.now() - startMs, contactId: contact?.contactId }, 'Context preloaded')

  return {
    contactId: contact?.contactId ?? null,
    contactName: contact?.displayName ?? null,
    contactMemory,
    pendingCommitments,
    recentSummaries,
    systemInstruction,
    tools: allDeclarations,
  }
}

/**
 * Persist call transcript to memory system and enqueue compression pipeline.
 * Connects voice calls to the same archive→summary→chunk→embed pipeline as WhatsApp/Gmail.
 */
export async function persistToMemory(
  registry: Registry,
  db: Pool,
  contactId: string,
  sessionId: string,
  startedAt: Date,
  transcript: TranscriptEntry[],
): Promise<void> {
  if (transcript.length === 0) return

  try {
    // 1. Save significant turns as messages linked to the real session
    const memMgr = registry.getOptional<{
      saveMessage: (msg: {
        id: string
        contactId: string
        sessionId: string
        channelName: string
        senderType: 'user' | 'agent'
        senderId: string
        content: { type: string; text?: string }
        role: string
        contentText: string
        contentType: 'text'
        createdAt: Date
      }) => Promise<void>
    }>('memory:manager')

    if (memMgr) {
      for (const entry of transcript) {
        if (entry.speaker === 'system' || entry.text.length < 5) continue
        const isCaller = entry.speaker === 'caller'
        await memMgr.saveMessage({
          id: crypto.randomUUID(),
          contactId,
          sessionId,
          channelName: 'voice',
          senderType: isCaller ? 'user' : 'agent',
          senderId: isCaller ? contactId : 'assistant',
          content: { type: 'text', text: entry.text },
          role: isCaller ? 'user' : 'assistant',
          contentText: entry.text,
          contentType: 'text',
          createdAt: new Date(startedAt.getTime() + entry.timestampMs),
        }).catch(() => {})
      }
    }

    // 2. Close the session
    await db.query(
      `UPDATE sessions SET status = 'closed', last_activity_at = NOW() WHERE id = $1`,
      [sessionId],
    )

    // 3. Enqueue compression (same pipeline as WhatsApp/Gmail)
    const compressionWorker = registry.getOptional<{
      enqueue: (data: {
        sessionId: string
        contactId: string
        channel: string
        triggerType: 'reopen_expired' | 'nightly_batch'
      }) => Promise<void>
    }>('memory:compression-worker')

    if (compressionWorker) {
      await compressionWorker.enqueue({
        sessionId,
        contactId,
        channel: 'voice',
        triggerType: 'reopen_expired',
      })
    }
    // If compression worker unavailable, nightly batch will pick up the closed session
  } catch (err) {
    logger.error({ err, contactId, sessionId }, 'Failed to persist call to memory')
  }
}

// ═══════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════

async function buildSystemInstruction(
  prompts: AgentPrompts | null,
  contact: ContactInfo | null,
  contactMemory: string | null,
  pendingCommitments: string[],
  recentSummaries: string[],
  greeting: string,
  direction: CallDirection,
  config: TwilioVoiceConfig,
  registry?: Registry,
  outboundReason?: string,
  contactChannels: Array<{ channel_type: string; channel_identifier: string; is_primary: boolean }> = [],
): Promise<string> {
  const parts: string[] = []

  // Agent identity and job
  if (prompts) {
    if (prompts.identity) parts.push(prompts.identity)
    if (prompts.job) parts.push(prompts.job)
    if (prompts.guardrails) parts.push(prompts.guardrails)
    if (prompts.relationship) parts.push(prompts.relationship)
  }

  // Voice-specific instructions — load from template (Category 2)
  const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
  const channelFormat = registry ? await getChannelLimit('voice', registry) : ''
  if (channelFormat) {
    parts.push(channelFormat)
  }
  const callDirectionText = direction === 'inbound' ? 'ENTRANTE (el cliente te llama a ti)' : 'SALIENTE (t\u00fa llamas al cliente)'
  const outboundInstr = direction === 'outbound' ? 'Espera confirmaci\u00f3n de que es buen momento antes de continuar.' : ''
  let voiceInstr = svc
    ? await svc.getSystemPrompt('voice-system-instruction', {
        callDirection: callDirectionText,
        greeting,
        outboundInstruction: outboundInstr,
        fillerMessage: config.VOICE_FILLER_MESSAGE,
        silenceMessage: config.VOICE_SILENCE_MESSAGE,
      })
    : ''
  if (!voiceInstr) {
    voiceInstr = `## Instrucciones de llamada de voz\n\nEst\u00e1s en una llamada telef\u00f3nica en VIVO.\nSaludo: "${greeting}"\nFiller: "${config.VOICE_FILLER_MESSAGE}"\nSilencio: "${config.VOICE_SILENCE_MESSAGE}"`
  }
  parts.push(voiceInstr)

  // Outbound call reason (injected after voice instructions)
  if (direction === 'outbound' && outboundReason) {
    let outboundCtx = '\n\n## Llamada saliente'
    if (contact?.displayName) {
      outboundCtx += `\n\nEstás llamando a ${contact.displayName}.`
    }
    outboundCtx += ` Razón de la llamada: ${outboundReason}.`
    outboundCtx += ' Saluda, confirma que hablas con la persona correcta, y explica la razón de tu llamada.'
    parts.push(outboundCtx)
  }

  // Contact context
  if (contact || contactMemory || pendingCommitments.length > 0 || contactChannels.length > 0) {
    const contextParts: string[] = ['\n## Contexto del contacto']

    if (contact) {
      if (contact.displayName) contextParts.push(`- Nombre: ${contact.displayName}`)
      if (contact.status) contextParts.push(`- Estado: ${contact.status}`)
    }

    if (contactChannels.length > 0) {
      const channelLines = contactChannels.map(ch => {
        const primary = ch.is_primary ? ' (principal)' : ''
        return `- ${ch.channel_type}: ${ch.channel_identifier}${primary}`
      })
      contextParts.push(`\n### Puntos de contacto:\n${channelLines.join('\n')}`)
    }

    if (contactMemory) {
      contextParts.push(`\n### Memoria del contacto:\n${contactMemory}`)
    }

    if (pendingCommitments.length > 0) {
      contextParts.push(`\n### Compromisos pendientes:\n${pendingCommitments.map(c => `- ${c}`).join('\n')}`)
    }

    if (recentSummaries.length > 0) {
      contextParts.push(`\n### Conversaciones recientes:\n${recentSummaries.join('\n---\n')}`)
    }

    parts.push(contextParts.join('\n'))
  }

  return parts.join('\n\n')
}

interface ContactInfo {
  contactId: string
  displayName: string | null
  status: string | null
}

interface AgentPrompts {
  identity: string | null
  job: string | null
  guardrails: string | null
  relationship: string | null
}

async function loadContact(db: Pool, phoneNumber: string): Promise<ContactInfo | null> {
  // Normalize phone number: strip non-digit chars for matching
  const normalized = phoneNumber.replace(/\D/g, '')

  // Look up contact via voice channel entry in contact_channels.
  // Voice channels are auto-created from WhatsApp LID resolution,
  // linking phone calls to the same contact as WA messages.
  const result = await db.query<{ id: string; display_name: string | null; lead_status: string | null }>(
    `SELECT c.id, c.display_name, ac.lead_status
     FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
     WHERE cc.channel_type = 'voice'
       AND (cc.channel_identifier = $1 OR cc.channel_identifier = $2)
     LIMIT 1`,
    [phoneNumber, normalized],
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    contactId: row.id,
    displayName: row.display_name,
    status: row.lead_status,
  }
}

async function loadPrompts(registry: Registry): Promise<AgentPrompts | null> {
  const promptsService = registry.getOptional<{
    getCompositorPrompts: (userType: string) => Promise<{
      identity: string | null
      job: string | null
      guardrails: string | null
      relationship: string | null
    }>
  }>('prompts:service')

  if (!promptsService) return null
  return promptsService.getCompositorPrompts('lead')
}

async function loadTools(registry: Registry): Promise<{
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  declarations: GeminiToolDeclaration[]
}> {
  const toolRegistry = registry.getOptional<{
    getAvailableTools: (contactType?: string) => Array<{
      definition: { name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required?: string[] } }
    }>
  }>('tools:registry')

  if (!toolRegistry) return { tools: [], declarations: [] }

  const available = toolRegistry.getAvailableTools('lead')
  const declarations: GeminiToolDeclaration[] = available.map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    parameters: {
      type: 'object',
      properties: t.definition.parameters.properties,
      required: t.definition.parameters.required,
    },
  }))

  return { tools: available.map(t => t.definition), declarations }
}

async function loadContactMemory(registry: Registry, contactId: string): Promise<string | null> {
  const memMgr = registry.getOptional<{
    loadContactMemory: (contactId: string) => Promise<{ summary?: string; keyFacts?: string[] } | null>
  }>('memory:manager')

  if (!memMgr) return null
  const memory = await memMgr.loadContactMemory(contactId)
  if (!memory) return null

  const parts: string[] = []
  if (memory.summary) parts.push(memory.summary)
  if (memory.keyFacts && memory.keyFacts.length > 0) {
    parts.push('Datos clave: ' + memory.keyFacts.join('; '))
  }
  return parts.join('\n') || null
}

async function loadCommitments(registry: Registry, contactId: string): Promise<string[]> {
  const memMgr = registry.getOptional<{
    getPendingCommitments: (contactId: string) => Promise<Array<{ description: string }>>
  }>('memory:manager')

  if (!memMgr) return []
  const commitments = await memMgr.getPendingCommitments(contactId)
  return commitments.map(c => c.description)
}

async function loadSummaries(registry: Registry, contactId: string): Promise<string[]> {
  const memMgr = registry.getOptional<{
    getRecentSummaries: (contactId: string, limit: number) => Promise<Array<{ summary: string }>>
  }>('memory:manager')

  if (!memMgr) return []
  const summaries = await memMgr.getRecentSummaries(contactId, 3)
  return summaries.map(s => s.summary)
}

async function loadContactChannels(
  db: Pool,
  contactId: string,
): Promise<Array<{ channel_type: string; channel_identifier: string; is_primary: boolean }>> {
  try {
    const result = await db.query<{
      channel_type: string
      channel_identifier: string
      is_primary: boolean
    }>(
      `SELECT channel_type, channel_identifier, is_primary
       FROM contact_channels
       WHERE contact_id = $1
       ORDER BY is_primary DESC, last_used_at DESC NULLS LAST`,
      [contactId],
    )
    return result.rows
  } catch {
    return []
  }
}
