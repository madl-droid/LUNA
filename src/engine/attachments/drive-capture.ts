// LUNA Engine — Drive Tool Result Capture
// After a Google read tool (docs-read, sheets-read, slides-read) executes,
// captures the result and updates the corresponding attachment_extractions row.
// Also generates llm_text summary for large content in background.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'

const logger = pino({ name: 'engine:drive-capture' })

/** Google read tools that produce content worth capturing */
const GOOGLE_READ_TOOLS: Record<string, { idParam: string; extractText: (data: unknown) => string | null }> = {
  'docs-read': {
    idParam: 'documentId',
    extractText: (data) => {
      if (!data || typeof data !== 'object') return null
      const doc = data as { body?: string; title?: string }
      return doc.body ?? null
    },
  },
  'sheets-read': {
    idParam: 'spreadsheetId',
    extractText: (data) => {
      if (!data || typeof data !== 'object') return null
      const sheet = data as { values?: string[][]; range?: string }
      if (!sheet.values?.length) return null
      // Convert grid to readable text
      return sheet.values.map(row => row.join('\t')).join('\n')
    },
  },
  'slides-read': {
    idParam: 'presentationId',
    extractText: (data) => {
      if (!data || typeof data !== 'object') return null
      const slides = data as { text?: string }
      return slides.text ?? null
    },
  },
}

/**
 * Check if a tool call is a Google read tool and capture the result.
 * Called fire-and-forget after tool execution in the agentic loop.
 *
 * Matches the tool's fileId param against existing drive_reference rows
 * in attachment_extractions (stored in metadata JSONB).
 * If found, updates extracted_text + generates llm_text for large content.
 */
export async function captureDriveToolResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolData: unknown,
  success: boolean,
  sessionId: string,
  registry: Registry,
): Promise<void> {
  const toolConfig = GOOGLE_READ_TOOLS[toolName]
  if (!toolConfig || !success) return

  const fileId = toolInput[toolConfig.idParam]
  if (!fileId || typeof fileId !== 'string') return

  const extractedText = toolConfig.extractText(toolData)
  if (!extractedText) return

  const db = registry.getDb()

  try {
    // Find the drive_reference row that matches this fileId
    const res = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM attachment_extractions
       WHERE source_type = 'drive_reference' AND session_id = $1
         AND metadata->>'fileId' = $2
       ORDER BY created_at DESC LIMIT 1`,
      [sessionId, fileId],
    )

    const row = res.rows[0]
    if (!row) {
      // No pre-existing drive_reference row — tool was called directly, not from a URL
      logger.debug({ toolName, fileId, sessionId }, 'No drive_reference row found for tool result — skipping capture')
      return
    }

    if (row.status === 'processed') {
      // Already captured — skip (dedup)
      return
    }

    const tokenEstimate = Math.ceil(extractedText.length / 4)

    // Update the row with extracted content
    await db.query(
      `UPDATE attachment_extractions
       SET extracted_text = $1, token_estimate = $2, status = 'processed'
       WHERE id = $3`,
      [extractedText, tokenEstimate, row.id],
    )

    logger.info({ toolName, fileId, tokenEstimate, rowId: row.id }, 'Drive tool result captured into attachment_extractions')

    // Generate llm_text summary for large content (background, fire-and-forget)
    const smallDocTokens = 8000 // default threshold
    if (tokenEstimate > smallDocTokens) {
      generateDriveSummary(row.id, extractedText, db, registry).catch(err =>
        logger.warn({ err, rowId: row.id }, 'Failed to generate Drive file summary'),
      )
    } else {
      // Small content — llm_text = extracted_text (no extra LLM call needed)
      await db.query(
        `UPDATE attachment_extractions SET llm_text = $1 WHERE id = $2`,
        [extractedText, row.id],
      )
    }
  } catch (err) {
    logger.warn({ err, toolName, fileId, sessionId }, 'Drive tool result capture failed')
  }
}

/**
 * Generate a short LLM summary for large Drive file content.
 * Same pattern as processor.ts large doc summary.
 */
async function generateDriveSummary(
  rowId: string,
  extractedText: string,
  db: Pool,
  registry: Registry,
): Promise<void> {
  try {
    const result = await registry.callHook('llm:chat', {
      task: 'drive-summarize-large',
      system: 'Eres un asistente que resume documentos. Genera una descripción concisa pero completa del documento, cubriendo los puntos principales, estructura y datos relevantes. Responde en español. Máximo 500 palabras.',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: `Resume este documento:\n\n${extractedText.slice(0, 24000)}` },
        ],
      }],
      maxTokens: 1500,
      temperature: 0.1,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const summary = (result as { text: string }).text?.trim()
      if (summary) {
        await db.query(
          `UPDATE attachment_extractions SET llm_text = $1 WHERE id = $2`,
          [summary, rowId],
        )
        logger.info({ rowId, summaryLen: summary.length }, 'Drive file summary generated')
      }
    }
  } catch (err) {
    logger.warn({ err, rowId }, 'Drive summary LLM call failed')
  }
}
