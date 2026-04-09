// LUNA Engine — inspect_image tool
// Allows the LLM to re-query an image attachment by sending the binary back to the vision LLM
// with a specific question. Complements query_attachment (text) for visual content.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'

const logger = pino({ name: 'engine:tool:inspect-image' })

interface ToolRegistry {
  registerTool(toolDef: {
    definition: {
      name: string
      displayName: string
      description: string
      category: string
      sourceModule: string
      parameters: {
        type: 'object'
        properties: Record<string, { type: string; description: string }>
        required?: string[]
      }
    }
    handler: (input: Record<string, unknown>, ctx: { contactId?: string; sessionId?: string; correlationId: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

/**
 * Register the inspect_image tool with the tools registry.
 * Allows the agentic loop to re-examine an image with a specific question
 * when the initial generic description does not contain the needed detail.
 */
export async function registerInspectImageTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, inspect_image tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'inspect_image',
      displayName: 'Inspeccionar imagen',
      description: 'Re-examine a previously received image to answer a specific question about its visual content. Use when the initial image description does not contain the detail you need (e.g., "What brand is on the label?", "Is the damage on the front or back?").',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description: 'The ID of the image attachment (from the (id: ...) tag in the history).',
          },
          question: {
            type: 'string',
            description: 'Specific question about the image (e.g., "What brand is shown on the label?", "Is the damage on the front or back?").',
          },
        },
        required: ['attachment_id', 'question'],
      },
    },
    handler: async (input, ctx) => {
      const attachmentId = String(input.attachment_id ?? '')
      const question = String(input.question ?? '')

      if (!attachmentId || !question) {
        return { success: false, error: 'attachment_id and question are required' }
      }

      // 1. Look up attachment in DB — scope to session when available
      const db = registry.getDb()
      const res = await db.query<{ file_path: string | null; category: string; mime_type: string; filename: string }>(
        'SELECT file_path, category, mime_type, filename FROM attachment_extractions WHERE id = $1 AND ($2::uuid IS NULL OR session_id = $2)',
        [attachmentId, ctx.sessionId ?? null],
      )

      const row = res.rows[0]
      if (!row) {
        return { success: false, error: 'Attachment not found.' }
      }
      if (row.category !== 'images') {
        return { success: false, error: `Attachment "${row.filename}" is ${row.category}, not an image. Use query_attachment for text-based content.` }
      }
      if (!row.file_path) {
        return { success: false, error: `Image binary not available on disk for "${row.filename}".` }
      }

      // 2. Read binary from disk
      let buffer: Buffer
      try {
        const fullPath = resolve(process.cwd(), row.file_path)
        buffer = await readFile(fullPath)
      } catch {
        return { success: false, error: `Image file not found on disk: ${row.file_path}` }
      }

      // 3. Send to vision LLM with the specific question (not a generic description prompt)
      const base64 = buffer.toString('base64')
      const system = 'Examina la imagen y responde EXCLUSIVAMENTE la pregunta del usuario. Sé directo y específico. No describas la imagen completa — solo lo que se pregunta. Si no puedes determinar la respuesta con certeza, indica qué ves y qué no es posible confirmar.'

      try {
        const result = await registry.callHook('llm:chat', {
          task: 'extractor-image-vision',
          system,
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'image_url' as const, data: base64, mimeType: row.mime_type },
              { type: 'text' as const, text: question },
            ],
          }],
          maxTokens: 1000,
        })

        if (result && typeof result === 'object' && 'text' in result) {
          const answer = (result as { text: string }).text?.trim()
          if (answer) {
            logger.info({ attachmentId, questionLength: question.length, correlationId: ctx.correlationId }, 'inspect_image completed')
            return { success: true, data: { answer } }
          }
        }

        return { success: false, error: 'Vision model returned empty response.' }
      } catch (err) {
        logger.warn({ err, attachmentId }, 'inspect_image LLM call failed')
        return { success: false, error: 'Failed to analyze image. The vision service may be temporarily unavailable.' }
      }
    },
  })

  logger.info('inspect_image tool registered')
}
