// LUNA — Module: gmail — Tool Registration
// Registra herramientas de email (read inbox, search, get detail) en el sistema de tools.
// Patrón: mismo que google-apps/tools.ts — se llama desde manifest.ts init().

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { GmailAdapter } from './gmail-adapter.js'
import type { EmailMessage } from './types.js'

const logger = pino({ name: 'gmail:tools' })

/** Max chars to return for email body text in get-detail results. */
const BODY_MAX_CHARS = 3000

/** Strip HTML tags and decode basic entities for plain-text presentation. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Build a compact summary of an EmailMessage for tool results (token-efficient). */
function toSummary(msg: EmailMessage): Record<string, unknown> {
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: msg.fromName !== msg.from ? `${msg.fromName} <${msg.from}>` : msg.from,
    to: msg.to,
    subject: msg.subject,
    date: msg.date.toISOString(),
    isUnread: msg.labels.includes('UNREAD'),
    snippet: (msg.bodyText || stripHtml(msg.bodyHtml)).slice(0, 200),
  }
}

export async function registerEmailTools(
  registry: Registry,
  adapter: GmailAdapter,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping email tool registration')
    return
  }

  // ─── email-read-inbox ───────────────────────

  await toolRegistry.registerTool({
    definition: {
      name: 'email-read-inbox',
      displayName: 'Leer buzón de email',
      description:
        'Lee emails recientes del buzón de Gmail del agente. Permite filtrar por estado (no leídos, recientes, importantes, todos). Útil para verificar si hay emails pendientes o buscar un mensaje que un contacto menciona.',
      shortDescription: 'Lee emails recientes del buzón',
      category: 'email',
      sourceModule: 'gmail',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description:
              'Tipo de filtro: "unread" (no leídos, default), "recent" (últimos 3 días), "important" (importantes), "all" (todos en inbox)',
            enum: ['unread', 'recent', 'important', 'all'],
          },
          max_results: {
            type: 'number',
            description: 'Cantidad máxima de resultados (default: 10, máximo: 20)',
          },
        },
      },
    },
    handler: async (input) => {
      const filter = (input.filter as string) || 'unread'
      const maxResults = Math.min(Math.max((input.max_results as number) || 10, 1), 20)

      const queryMap: Record<string, string> = {
        unread: 'in:inbox is:unread',
        recent: 'in:inbox newer_than:3d',
        important: 'in:inbox is:important',
        all: 'in:inbox',
      }

      const query = queryMap[filter] ?? queryMap['unread']!

      try {
        const messages = await adapter.listMessages(query, maxResults)
        return {
          success: true,
          data: {
            count: messages.length,
            filter,
            emails: messages.map(toSummary),
          },
        }
      } catch (err) {
        logger.error({ err, filter }, 'email-read-inbox failed')
        return { success: false, error: `Failed to read inbox: ${String(err)}` }
      }
    },
  })

  // ─── email-search ───────────────────────────

  await toolRegistry.registerTool({
    definition: {
      name: 'email-search',
      displayName: 'Buscar emails',
      description:
        'Busca emails usando la sintaxis nativa de Gmail. Soporta operadores como from:, to:, subject:, has:attachment, newer_than:, older_than:, is:unread, label:, etc. Ejemplos: "from:juan@empresa.com", "subject:cotización has:attachment", "from:maria newer_than:7d".',
      shortDescription: 'Busca emails con sintaxis Gmail',
      category: 'email',
      sourceModule: 'gmail',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Query de búsqueda con sintaxis Gmail (from:, to:, subject:, has:attachment, newer_than:, etc.)',
          },
          max_results: {
            type: 'number',
            description: 'Cantidad máxima de resultados (default: 10, máximo: 20)',
          },
        },
        required: ['query'],
      },
    },
    handler: async (input) => {
      const query = input.query as string
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return { success: false, error: 'query is required and must be a non-empty string' }
      }

      const maxResults = Math.min(Math.max((input.max_results as number) || 10, 1), 20)

      try {
        const messages = await adapter.listMessages(query.trim(), maxResults)
        return {
          success: true,
          data: {
            count: messages.length,
            query: query.trim(),
            emails: messages.map(toSummary),
          },
        }
      } catch (err) {
        logger.error({ err, query }, 'email-search failed')
        return { success: false, error: `Failed to search emails: ${String(err)}` }
      }
    },
  })

  // ─── email-get-detail ───────────────────────

  await toolRegistry.registerTool({
    definition: {
      name: 'email-get-detail',
      displayName: 'Leer email completo',
      description:
        'Obtiene el contenido completo de un email específico por su ID (obtenido de email-read-inbox o email-search). Incluye cuerpo del mensaje, destinatarios (to, cc), asunto, fecha y cantidad de adjuntos.',
      shortDescription: 'Lee el contenido completo de un email por ID',
      category: 'email',
      sourceModule: 'gmail',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'ID del mensaje de Gmail (obtenido de email-read-inbox o email-search)',
          },
        },
        required: ['message_id'],
      },
    },
    handler: async (input) => {
      const messageId = input.message_id as string
      if (!messageId || typeof messageId !== 'string' || messageId.trim().length === 0) {
        return { success: false, error: 'message_id is required and must be a non-empty string' }
      }

      try {
        const msg = await adapter.getFullMessage(messageId.trim())
        if (!msg) {
          return { success: false, error: `Email with ID ${messageId} not found` }
        }

        // Prefer plain text body; fall back to stripped HTML
        let body = msg.bodyText || stripHtml(msg.bodyHtml)
        if (body.length > BODY_MAX_CHARS) {
          body = body.slice(0, BODY_MAX_CHARS) + '\n\n[... truncado]'
        }

        return {
          success: true,
          data: {
            id: msg.id,
            threadId: msg.threadId,
            from: msg.fromName !== msg.from ? `${msg.fromName} <${msg.from}>` : msg.from,
            to: msg.to,
            cc: msg.cc,
            subject: msg.subject,
            date: msg.date.toISOString(),
            body,
            isReply: msg.isReply,
            attachments: msg.attachments.length > 0
              ? msg.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size }))
              : undefined,
          },
        }
      } catch (err) {
        logger.error({ err, messageId }, 'email-get-detail failed')
        return { success: false, error: `Failed to get email detail: ${String(err)}` }
      }
    },
  })

  logger.info('Registered 3 email tools: email-read-inbox, email-search, email-get-detail')
}
