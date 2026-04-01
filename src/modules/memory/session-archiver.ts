// LUNA — Session Archiver
// Legal archive of session messages + LLM summary generation.
// Archives text + attachment metadata (no binaries) for legal compliance.
// Generates structured summary with title, description, and full summary.

import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  StoredMessage,
  SessionSummaryV2,
  AttachmentArchiveMeta,
} from './types.js'
import type { AttachmentExtraction } from './session-chunker.js'

const logger = pino({ name: 'memory:session-archiver' })

// ═══════════════════════════════════════════
// Legal archive
// ═══════════════════════════════════════════

export async function archiveSessionLegal(
  db: Pool,
  sessionId: string,
  contactId: string,
  channel: string,
  startedAt: Date,
  closedAt: Date,
  messages: StoredMessage[],
  attachments: AttachmentExtraction[],
): Promise<string> {
  // Build text-only messages (no binaries)
  const messagesJson = messages.map(m => ({
    id: m.id,
    role: m.role,
    contentText: m.contentText || m.content?.text || '',
    contentType: m.contentType,
    createdAt: m.createdAt,
    metadata: m.metadata ?? null,
  }))

  // Build attachment metadata
  const attachmentsMeta: AttachmentArchiveMeta[] = attachments.map(att => ({
    filename: att.filename,
    category: att.category,
    mimeType: att.mimeType,
    filePath: att.filePath,
    extractionId: att.id,
  }))

  const result = await db.query<{ id: string }>(
    `INSERT INTO session_archives (session_id, contact_id, channel, started_at, closed_at, message_count, messages_json, attachments_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      sessionId,
      contactId,
      channel,
      startedAt,
      closedAt,
      messages.length,
      JSON.stringify(messagesJson),
      attachmentsMeta.length > 0 ? JSON.stringify(attachmentsMeta) : null,
    ],
  )

  const archiveId = result.rows[0]!.id
  logger.info({ sessionId, archiveId, messageCount: messages.length, attachments: attachmentsMeta.length }, 'Session archived for legal compliance')
  return archiveId
}

// ═══════════════════════════════════════════
// LLM Summary generation
// ═══════════════════════════════════════════

export async function generateSessionSummary(
  db: Pool,
  registry: Registry,
  sessionId: string,
  contactId: string,
  messages: StoredMessage[],
  attachments: AttachmentExtraction[],
): Promise<SessionSummaryV2 | null> {
  // Build conversation text
  const conversationText = messages
    .map(m => `[${m.role === 'assistant' ? 'Agente' : 'Usuario'}]: ${m.contentText || m.content?.text || ''}`)
    .filter(line => line.length > 10)
    .join('\n')

  // Build attachment context
  const attachmentContext = attachments.length > 0
    ? '\n\nAdjuntos procesados:\n' + attachments.map(att => {
      const desc = att.llmText || att.extractedText || '(sin descripción)'
      return `- [${att.category}] ${att.filename} (${att.mimeType}): ${desc.slice(0, 300)}`
    }).join('\n')
    : ''

  const userContent = `Analiza esta conversación y genera un resumen estructurado.

CONVERSACIÓN:
${conversationText.slice(0, 15000)}
${attachmentContext.slice(0, 3000)}

Responde SOLO con JSON válido:
{
  "title": "título descriptivo (máximo 15 palabras)",
  "description": "descripción concisa (máximo 5 oraciones)",
  "full_summary": "resumen completo mencionando: documentos revisados, imágenes analizadas, decisiones tomadas, compromisos, datos extraídos, navegación web si hubo"
}`

  const llmResult = await registry.callHook('llm:chat', {
    task: 'session-summary-v2',
    system: 'Eres un asistente que resume conversaciones de ventas/atención al cliente. Genera resúmenes estructurados precisos.',
    messages: [{ role: 'user' as const, content: userContent }],
    maxTokens: 2000,
    temperature: 0.3,
  })

  if (!llmResult?.text) {
    logger.error({ sessionId }, 'LLM returned no text for session summary')
    return null
  }

  const parsed = parseJSON(llmResult.text)
  if (!parsed?.title || !parsed?.description || !parsed?.full_summary) {
    logger.error({ sessionId, text: llmResult.text.slice(0, 200) }, 'Failed to parse session summary JSON')
    return null
  }

  const modelUsed = llmResult.model ?? null
  const tokensUsed = ((llmResult.inputTokens ?? 0) + (llmResult.outputTokens ?? 0)) || null

  const result = await db.query<{ id: string }>(
    `INSERT INTO session_summaries_v2 (session_id, contact_id, title, description, full_summary, model_used, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (session_id) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       full_summary = EXCLUDED.full_summary, model_used = EXCLUDED.model_used,
       tokens_used = EXCLUDED.tokens_used
     RETURNING id`,
    [
      sessionId,
      contactId,
      String(parsed.title).slice(0, 200),
      String(parsed.description).slice(0, 1000),
      String(parsed.full_summary),
      modelUsed,
      tokensUsed,
    ],
  )

  const summary: SessionSummaryV2 = {
    id: result.rows[0]!.id,
    sessionId,
    contactId,
    title: String(parsed.title),
    description: String(parsed.description),
    fullSummary: String(parsed.full_summary),
    modelUsed,
    tokensUsed,
  }

  logger.info({ sessionId, summaryId: summary.id, title: summary.title }, 'Session summary generated')
  return summary
}

// ═══════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════

function parseJSON(text: string): Record<string, unknown> | null {
  try {
    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}
