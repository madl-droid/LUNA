// LUNA — Module: twilio-voice — Voice Engine
// Pipeline ligero para llamadas de voz. Delega la conversación a Gemini Live
// mientras LUNA provee contexto, tools y monitoreo.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { Pool } from 'pg'
import type {
  TwilioVoiceConfig,
  PreloadedContext,
  GeminiToolDeclaration,
  CallDirection,
  TranscriptEntry,
} from './types.js'

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
): Promise<PreloadedContext> {
  const startMs = Date.now()

  // Parallel context loading (similar to Phase 1 but minimal)
  const [contactResult, promptsResult, toolsResult, agentResult] = await Promise.allSettled([
    loadContact(db, phoneNumber),
    loadPrompts(registry),
    loadTools(registry),
    loadAgentId(db),
  ])

  const contact = contactResult.status === 'fulfilled' ? contactResult.value : null
  const prompts = promptsResult.status === 'fulfilled' ? promptsResult.value : null
  const tools = toolsResult.status === 'fulfilled' ? toolsResult.value : { tools: [], declarations: [] }
  const agentId = agentResult.status === 'fulfilled' ? agentResult.value : 'default'

  // Load memory if contact exists
  let contactMemory: string | null = null
  let pendingCommitments: string[] = []
  let recentSummaries: string[] = []

  if (contact?.contactId) {
    const memResults = await Promise.allSettled([
      loadContactMemory(registry, contact.contactId),
      loadCommitments(registry, contact.contactId),
      loadSummaries(registry, contact.contactId),
    ])

    contactMemory = memResults[0]!.status === 'fulfilled' ? memResults[0]!.value : null
    pendingCommitments = memResults[1]!.status === 'fulfilled' ? memResults[1]!.value : []
    recentSummaries = memResults[2]!.status === 'fulfilled' ? memResults[2]!.value : []
  }

  // Build system instruction
  const greeting = direction === 'inbound'
    ? config.VOICE_GREETING_INBOUND
    : config.VOICE_GREETING_OUTBOUND

  const systemInstruction = buildSystemInstruction(
    prompts,
    contact,
    contactMemory,
    pendingCommitments,
    recentSummaries,
    greeting,
    direction,
    config,
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
    agentId,
    systemInstruction,
    tools: allDeclarations,
  }
}

/**
 * Generate a call summary from transcript using LLM.
 */
export async function generateCallSummary(
  registry: Registry,
  transcript: TranscriptEntry[],
  contactName: string | null,
): Promise<string | null> {
  if (transcript.length === 0) return null

  const transcriptText = transcript
    .map(t => `${t.speaker === 'caller' ? (contactName ?? 'Caller') : 'Agente'}: ${t.text}`)
    .join('\n')

  try {
    const result = await registry.callHook('llm:chat', {
      task: 'summarize',
      system: 'Resume la siguiente conversaci\u00f3n telef\u00f3nica en 2-3 oraciones. Incluye: tema principal, acuerdos/compromisos, y pr\u00f3ximos pasos si los hay. Responde solo con el resumen, sin encabezados.',
      messages: [{ role: 'user', content: transcriptText }],
      maxTokens: 300,
      temperature: 0.3,
      traceId: `call-summary-${Date.now()}`,
    })

    return result?.text ?? null
  } catch (err) {
    logger.error({ err }, 'Failed to generate call summary')
    return null
  }
}

/**
 * Persist call transcript and summary to memory system.
 */
export async function persistToMemory(
  registry: Registry,
  db: Pool,
  contactId: string,
  agentId: string,
  transcript: TranscriptEntry[],
  summary: string | null,
): Promise<void> {
  if (transcript.length === 0) return

  try {
    // Save key turns as messages via memory:manager (if available)
    const memMgr = registry.getOptional<{
      saveMessage: (msg: {
        agentId: string
        contactId: string
        sessionId: string
        role: string
        content: string
        channel: string
      }) => Promise<void>
    }>('memory:manager')

    if (memMgr) {
      // Create a pseudo-session for this call
      const sessionId = `voice-${Date.now()}`

      // Save significant turns (skip very short utterances)
      for (const entry of transcript) {
        if (entry.text.length < 5) continue
        await memMgr.saveMessage({
          agentId,
          contactId,
          sessionId,
          role: entry.speaker === 'caller' ? 'user' : 'assistant',
          content: entry.text,
          channel: 'voice',
        }).catch(() => {}) // fire-and-forget
      }
    }
  } catch (err) {
    logger.error({ err, contactId }, 'Failed to persist call to memory')
  }
}

// ═══════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════

function buildSystemInstruction(
  prompts: AgentPrompts | null,
  contact: ContactInfo | null,
  contactMemory: string | null,
  pendingCommitments: string[],
  recentSummaries: string[],
  greeting: string,
  direction: CallDirection,
  config: TwilioVoiceConfig,
): string {
  const parts: string[] = []

  // Agent identity and job
  if (prompts) {
    if (prompts.identity) parts.push(prompts.identity)
    if (prompts.job) parts.push(prompts.job)
    if (prompts.guardrails) parts.push(prompts.guardrails)
    if (prompts.relationship) parts.push(prompts.relationship)
  }

  // Voice-specific instructions
  parts.push(`
## Instrucciones de llamada de voz

Est\u00e1s en una llamada telef\u00f3nica en VIVO. Tu respuesta es audio hablado en tiempo real.

### Comportamiento natural:
- Habla de forma natural y conversacional, como en una llamada telef\u00f3nica real
- Usa pausas naturales, muletillas y confirmaciones ("ajá", "entiendo", "claro")
- NO uses formato escrito (listas, markdown, URLs). Todo debe ser hablado
- S\u00e9 concisa: las respuestas largas son cansadoras por tel\u00e9fono

### Saludo inicial:
Esta es una llamada ${direction === 'inbound' ? 'ENTRANTE (el cliente te llama a ti)' : 'SALIENTE (t\u00fa llamas al cliente)'}.
Tu primer mensaje al conectar debe ser: "${greeting}"
${direction === 'outbound' ? 'Espera confirmaci\u00f3n de que es buen momento antes de continuar.' : ''}

### Cuando necesites procesar algo:
Si necesitas usar una herramienta o toma tiempo, di algo natural como "${config.VOICE_FILLER_MESSAGE}" antes de ejecutar la herramienta.

### Silencio del caller:
Si recibes un mensaje del sistema indicando que el caller est\u00e1 en silencio, pregunta amablemente: "${config.VOICE_SILENCE_MESSAGE}"

### Finalizar la llamada:
- NUNCA cuelgues abruptamente
- Cuando detectes que la conversaci\u00f3n termina naturalmente (despedidas, "eso es todo"), confirma: "\u00bfHay algo m\u00e1s en lo que pueda ayudarte?"
- Si confirman que terminaron, desp\u00eddete c\u00e1lidamente y usa la herramienta end_call
- Espera a que el caller se despida primero si es posible`)

  // Contact context
  if (contact || contactMemory || pendingCommitments.length > 0) {
    const contextParts: string[] = ['\n## Contexto del contacto']

    if (contact) {
      if (contact.displayName) contextParts.push(`- Nombre: ${contact.displayName}`)
      if (contact.status) contextParts.push(`- Estado: ${contact.status}`)
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
  const result = await db.query<{ id: string; display_name: string | null; qualification_status: string | null }>(
    `SELECT c.id, c.display_name, c.qualification_status
     FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     WHERE cc.channel_name = 'voice'
       AND (cc.channel_contact_id = $1 OR cc.channel_contact_id = $2)
     LIMIT 1`,
    [phoneNumber, normalized],
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    contactId: row.id,
    displayName: row.display_name,
    status: row.qualification_status,
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

async function loadAgentId(db: Pool): Promise<string> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM agents WHERE is_default = true LIMIT 1`,
  )
  return result.rows[0]?.id ?? 'default'
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
