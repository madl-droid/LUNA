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
  const tools = toolsResult.status === 'fulfilled' ? toolsResult.value : { declarations: [], extendedCatalog: '' }

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

  let systemInstruction = await buildSystemInstruction(
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

  // Append extended tool catalog to system instruction (lightweight text stubs)
  if (tools.extendedCatalog) {
    systemInstruction += '\n\n' + tools.extendedCatalog
  }

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

  // Agent identity, job (trimmed for voice), accent, guardrails, relationship
  if (prompts) {
    if (prompts.identity) parts.push(prompts.identity)
    if (prompts.job) parts.push(trimJobForVoice(prompts.job))
    if (prompts.accent) parts.push(prompts.accent)
    if (prompts.guardrails) parts.push(prompts.guardrails)
    if (prompts.relationship) parts.push(prompts.relationship)
  }

  // Voice-specific instructions — load from template (Category 2)
  const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
  const channelFormat = registry ? await getChannelLimit('voice', registry) : ''
  if (channelFormat) {
    parts.push(channelFormat)
  }

  // Build rich call scenario context based on direction
  const callScenario = buildCallScenario(direction, contact, outboundReason)

  const outboundInstr = direction === 'outbound'
    ? 'Espera confirmación de que es buen momento antes de continuar.'
    : ''

  const voiceInstr = svc
    ? await svc.getSystemPrompt('voice-system-instruction', {
        callScenario,
        greeting,
        outboundInstruction: outboundInstr,
        fillerMessage: config.VOICE_FILLER_MESSAGE,
        silenceMessage: config.VOICE_SILENCE_MESSAGE,
      })
    : ''
  if (voiceInstr) {
    parts.push(voiceInstr)
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

/**
 * Build a rich scenario description so the voice AI knows exactly what's happening.
 */
function buildCallScenario(
  direction: CallDirection,
  contact: ContactInfo | null,
  outboundReason?: string,
): string {
  const lines: string[] = []

  if (direction === 'inbound') {
    lines.push('Esta es una LLAMADA ENTRANTE — el cliente/lead te está llamando a ti.')
    if (contact?.displayName) {
      lines.push(`Quien llama: ${contact.displayName}${contact.status ? ` (estado: ${contact.status})` : ''}.`)
      lines.push('Ya lo conoces — consulta su contexto y memoria más abajo.')
    } else {
      lines.push('No tienes registro de este número. Puede ser un lead nuevo.')
    }
    lines.push('')
    lines.push('Protocolo de llamada entrante:')
    lines.push('1. Saluda con tu greeting configurado')
    lines.push('2. Escucha atentamente qué necesita')
    lines.push('3. Si es desconocido, pregunta su nombre y en qué puedes ayudarle')
    lines.push('IMPORTANTE: No repitas el nombre del contacto en cada frase. Úsalo solo al saludar y de manera esporádica.')
  } else {
    lines.push('Esta es una LLAMADA SALIENTE — TÚ estás llamando al cliente/lead.')
    if (contact?.displayName) {
      lines.push(`Estás llamando a: ${contact.displayName}${contact.status ? ` (estado: ${contact.status})` : ''}.`)
    }
    if (outboundReason) {
      lines.push(`Razón de la llamada: ${outboundReason}`)
    }
    lines.push('')
    lines.push('Protocolo de llamada saliente:')
    lines.push('1. Saluda y preséntate')
    lines.push('2. Confirma que hablas con la persona correcta')
    lines.push('3. Pregunta si es buen momento para hablar')
    lines.push('4. Explica brevemente la razón de tu llamada')
    lines.push('5. Si dicen que no es buen momento, pregunta cuándo puedes volver a llamar')
    lines.push('IMPORTANTE: No repitas el nombre del contacto en cada frase. Úsalo solo al inicio y de manera esporádica.')
  }

  return lines.join('\n')
}

/**
 * Trim the job prompt for voice. The full job prompt may include long frameworks
 * (e.g., Bryan Tracy 6 steps, objection handling guides) that add latency
 * without adding value in real-time voice. Keep only the mission section.
 */
function trimJobForVoice(job: string): string {
  // Cut at markdown headers that signal detailed frameworks (##, ###)
  const headerIdx = job.indexOf('\n## ')
  if (headerIdx > 0) {
    const trimmed = job.substring(0, headerIdx).trim()
    return trimmed + '\n\n(En voz: sé concisa y natural. Aplica tu criterio sin frameworks largos.)'
  }
  return job
}

interface ContactInfo {
  contactId: string
  displayName: string | null
  status: string | null
}

interface AgentPrompts {
  identity: string | null
  job: string | null
  accent: string | null
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
      accent: string | null
      guardrails: string | null
      relationship: string | null
    }>
  }>('prompts:service')

  if (!promptsService) return null
  return promptsService.getCompositorPrompts('lead')
}

/**
 * Core tools that get full Gemini function declarations (with JSON schemas).
 * These are the most common tools in voice calls and need low-latency access.
 */
const VOICE_CORE_TOOLS = new Set([
  'search_knowledge',
  'expand_knowledge',
  'calendar-check-availability',
  'calendar-create-event',
  'calendar-get-scheduling-context',
  'calendar-list-events',
  'request_human_help',
  'extract_qualification',
  'make_call',
  'send_email',
  'query_pending_items',
  'create_commitment',
  'update_commitment',
])

/**
 * The proxy tool declaration. Gemini calls this to use any extended tool
 * that isn't in the core set. The call-manager routes it to tools:registry.
 */
const USE_TOOL_DECLARATION: GeminiToolDeclaration = {
  name: 'use_tool',
  description: 'Ejecuta cualquier herramienta extendida del catálogo que no esté disponible directamente. ' +
    'Úsala cuando necesites una tool que aparece en el catálogo de herramientas extendidas del system prompt.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Nombre exacto de la herramienta del catálogo (ej: "docs-create", "sheets-read")',
      },
      arguments: {
        type: 'object',
        description: 'Argumentos para la herramienta. Pasa los parámetros que creas necesarios según la descripción de la tool.',
      },
    },
    required: ['tool_name'],
  },
}

interface ToolLoadResult {
  declarations: GeminiToolDeclaration[]
  extendedCatalog: string // text catalog for system prompt
}

async function loadTools(registry: Registry): Promise<ToolLoadResult> {
  const toolRegistry = registry.getOptional<{
    getAvailableTools: (contactType?: string) => Array<{
      definition: { name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required?: string[] } }
    }>
    getCatalog: (contactType?: string) => Array<{ name: string; description: string; category: string }>
  }>('tools:registry')

  if (!toolRegistry) return { declarations: [], extendedCatalog: '' }

  // Core tools: full Gemini function declarations
  const allAvailable = toolRegistry.getAvailableTools('lead')
  const coreTools = allAvailable.filter(t => VOICE_CORE_TOOLS.has(t.definition.name))

  const declarations: GeminiToolDeclaration[] = coreTools.map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    parameters: {
      type: 'object',
      properties: t.definition.parameters.properties,
      required: t.definition.parameters.required,
    },
  }))

  // Extended tools: text catalog for system prompt (lightweight)
  const catalog = toolRegistry.getCatalog('lead')
  const coreNames = new Set(coreTools.map(t => t.definition.name))
  const extendedTools = catalog.filter(t => !coreNames.has(t.name))

  let extendedCatalog = ''
  if (extendedTools.length > 0) {
    const lines = [
      '\n## Herramientas extendidas',
      'Estas herramientas adicionales están disponibles bajo demanda. Para usarlas, llama a use_tool(tool_name, arguments):',
    ]
    for (const t of extendedTools) {
      lines.push(`- ${t.name} [${t.category}]: ${t.description}`)
    }
    extendedCatalog = lines.join('\n')
    // Add the proxy tool declaration
    declarations.push(USE_TOOL_DECLARATION)
  }

  logger.info({
    coreCount: coreTools.length,
    extendedCount: extendedTools.length,
    coreTools: declarations.filter(d => d.name !== 'use_tool').map(d => d.name),
  }, 'Voice tools loaded (core + extended catalog)')

  return { declarations, extendedCatalog }
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
