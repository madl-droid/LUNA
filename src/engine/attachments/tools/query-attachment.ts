// LUNA Engine — query_attachment tool
// Allows the LLM to re-query large cached documents during Phase 3.
// Reads from Redis cache (att:{sessionId}:{attachmentId}).

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'

const logger = pino({ name: 'engine:tool:query-attachment' })

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
    handler: (input: Record<string, unknown>, ctx: { contactId?: string; correlationId: string; redis?: import('ioredis').Redis }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

/**
 * Register the query_attachment tool with the tools registry.
 */
export async function registerQueryAttachmentTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, query_attachment tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'query_attachment',
      displayName: 'Consultar adjunto',
      description: 'Query a specific section of a large attached document. Use when a document was too large to include fully and you need specific information from it.',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description: 'The ID of the attachment to query (from attachmentContext).',
          },
          query: {
            type: 'string',
            description: 'What information to look for in the document.',
          },
          section: {
            type: 'string',
            description: 'Optional: specific section or keyword to focus the search on.',
          },
        },
        required: ['attachment_id', 'query'],
      },
    },
    handler: async (input, ctx) => {
      const attachmentId = String(input.attachment_id ?? '')
      const query = String(input.query ?? '')

      if (!attachmentId || !query) {
        return { success: false, error: 'attachment_id and query are required' }
      }

      // Read from Redis cache
      const redis = registry.getRedis()
      if (!redis) {
        return { success: false, error: 'Redis not available' }
      }

      // Try to find the cache key using the session pattern
      const keys = await redis.keys(`att:*:${attachmentId}`)
      if (keys.length === 0) {
        return { success: false, error: 'Attachment not found in cache (may have expired)' }
      }

      const cacheKey = keys[0]!
      const fullText = await redis.get(cacheKey)
      if (!fullText) {
        return { success: false, error: 'Attachment content expired from cache' }
      }

      // Simple search: find paragraphs matching the query terms
      const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
      const section = input.section ? String(input.section).toLowerCase() : null
      const paragraphs = fullText.split(/\n\n+/)

      const scored = paragraphs.map((para, idx) => {
        const lower = para.toLowerCase()
        let score = 0
        for (const term of queryTerms) {
          if (lower.includes(term)) score += 1
        }
        if (section && lower.includes(section)) score += 3
        return { para, idx, score }
      })

      scored.sort((a, b) => b.score - a.score)

      // Return top relevant paragraphs (up to ~8K chars)
      const relevant: string[] = []
      let totalChars = 0
      const MAX_CHARS = 8000

      for (const item of scored) {
        if (item.score === 0) break
        if (totalChars + item.para.length > MAX_CHARS) break
        relevant.push(item.para)
        totalChars += item.para.length
      }

      if (relevant.length === 0) {
        // Fallback: return first chunk
        const fallback = fullText.slice(0, MAX_CHARS)
        return {
          success: true,
          data: {
            match: 'fallback',
            content: fallback,
            note: 'No specific section matched the query. Showing beginning of document.',
          },
        }
      }

      logger.info({
        attachmentId,
        matchedParagraphs: relevant.length,
        correlationId: ctx.correlationId,
      }, 'query_attachment matched content')

      return {
        success: true,
        data: {
          match: 'found',
          sections: relevant.length,
          content: relevant.join('\n\n'),
        },
      }
    },
  })

  logger.info('query_attachment tool registered')
}
