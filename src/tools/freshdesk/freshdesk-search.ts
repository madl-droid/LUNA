// LUNA — Tool: freshdesk_search
// Searches Freshdesk Knowledge Base by keyword via API.
// Fallback for when local metadata cache doesn't have good matches.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../../modules/tools/tool-registry.js'
import { FreshdeskClient } from './freshdesk-client.js'
import type { FreshdeskModuleConfig, FreshdeskSearchToolResult } from './types.js'

const logger = pino({ name: 'freshdesk:search' })

/**
 * Register the freshdesk_search tool with the tool registry.
 */
export async function registerFreshdeskSearchTool(
  registry: Registry,
  config: FreshdeskModuleConfig,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping freshdesk_search registration')
    return
  }

  const client = new FreshdeskClient(config.FRESHDESK_DOMAIN, config.FRESHDESK_API_KEY)

  await toolRegistry.registerTool({
    definition: {
      name: 'freshdesk_search',
      displayName: 'Buscar en Freshdesk',
      description: 'Busca artículos de soporte técnico en Freshdesk por keyword. Usar cuando el lead tiene una pregunta técnica y no hay matches relevantes en la knowledge base local.',
      category: 'knowledge',
      sourceModule: 'freshdesk',
      parameters: {
        type: 'object',
        properties: {
          term: {
            type: 'string',
            description: 'Keyword o frase corta de búsqueda',
          },
        },
        required: ['term'],
      },
    },
    handler: async (input) => {
      const term = input.term as string
      if (!term || typeof term !== 'string' || term.trim().length === 0) {
        return { success: false, error: 'term is required and must be a non-empty string' }
      }

      const result = await searchArticles(client, term.trim())
      return {
        success: result.success,
        data: result,
        error: result.error,
      }
    },
  })

  logger.info('freshdesk_search tool registered')
}

async function searchArticles(
  client: FreshdeskClient,
  term: string,
): Promise<FreshdeskSearchToolResult> {
  try {
    const results = await client.searchArticles(term)

    // Filter published only, take top 5
    const published = results
      .filter(r => r.status === 2)
      .slice(0, 5)
      .map(r => ({
        article_id: r.id,
        title: r.title,
        snippet: (r.description_text ?? '').substring(0, 300),
        tags: r.tags ?? [],
      }))

    return { success: true, results: published }
  } catch (err) {
    logger.error({ term, err: String(err) }, 'Freshdesk search failed')
    return { success: false, results: [], error: `Search failed: ${String(err)}` }
  }
}
