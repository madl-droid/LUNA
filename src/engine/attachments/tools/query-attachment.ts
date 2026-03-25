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

/** Tokenize text: lowercase, split by whitespace/punctuation, filter short tokens */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s,.;:!?()[\]{}"']+/).filter(t => t.length > 2)
}

/**
 * Build IDF (Inverse Document Frequency) from the document itself.
 * Language-agnostic: words appearing in many paragraphs automatically get low weight,
 * effectively eliminating stop words in any language without hardcoded lists.
 */
function buildIDF(queryTerms: string[], paraTokens: string[][], totalParagraphs: number): Map<string, number> {
  const idf = new Map<string, number>()
  for (const term of queryTerms) {
    let docsWithTerm = 0
    for (const tokens of paraTokens) {
      if (tokens.includes(term)) docsWithTerm++
    }
    // IDF = log(N / df). If term not found in any paragraph, IDF = 0
    idf.set(term, docsWithTerm > 0 ? Math.log(totalParagraphs / docsWithTerm) : 0)
  }
  return idf
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

      // IDF-weighted search: language-agnostic, no stop word lists needed
      const queryTerms = tokenize(query)
      const section = input.section ? String(input.section).toLowerCase() : null
      const paragraphs = fullText.split(/\n\n+/).filter(p => p.trim().length > 0)

      if (paragraphs.length === 0 || queryTerms.length === 0) {
        return { success: true, data: { match: 'fallback', content: fullText.slice(0, 8000), note: 'Empty document or query.' } }
      }

      // Tokenize each paragraph once
      const paraTokens = paragraphs.map(p => tokenize(p))

      // Build IDF from document: terms in many paragraphs get low weight (eliminates stop words in any language)
      const idf = buildIDF(queryTerms, paraTokens, paragraphs.length)

      // Score each paragraph using TF * IDF
      const scored = paragraphs.map((para, idx) => {
        const tokens = paraTokens[idx]!
        let score = 0
        for (const term of queryTerms) {
          const tf = tokens.filter(t => t === term).length
          score += tf * (idf.get(term) ?? 0)
        }
        if (section && para.toLowerCase().includes(section)) {
          const maxIdf = Math.max(...[...idf.values()], 1)
          score += 3 * maxIdf
        }
        return { para, idx, score }
      })

      scored.sort((a, b) => b.score - a.score)

      // Return top relevant paragraphs with minimum threshold (up to ~8K chars)
      const relevant: string[] = []
      let totalChars = 0
      const MAX_CHARS = 8000
      const MIN_SCORE = 0.5

      for (const item of scored) {
        if (item.score < MIN_SCORE) break
        if (totalChars + item.para.length > MAX_CHARS) break
        relevant.push(item.para)
        totalChars += item.para.length
      }

      if (relevant.length === 0) {
        // Fallback: return longest paragraph (most likely to have real content vs headers)
        const longest = paragraphs.reduce((a, b) => a.length >= b.length ? a : b, '')
        return {
          success: true,
          data: {
            match: 'fallback',
            content: longest.slice(0, MAX_CHARS),
            note: 'No specific section matched the query. Showing longest paragraph.',
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
