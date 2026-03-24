// LUNA Engine — web_explore tool
// Sub-agent tool for exploring URLs that failed pre-fetch (SPA, auth-protected, complex pages).
// Result passes through injection-validator before entering context.

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import { validateInjection } from '../injection-validator.js'

const logger = pino({ name: 'engine:tool:web-explore' })

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
    handler: (input: Record<string, unknown>, ctx: { contactId?: string; correlationId: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

/** Timeout for web_explore fetch (stricter than URL extractor) */
const WEB_EXPLORE_TIMEOUT_MS = 15000
const WEB_EXPLORE_MAX_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Register the web_explore tool with the tools registry.
 */
export async function registerWebExploreTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, web_explore tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'web_explore',
      displayName: 'Explorar pagina web',
      description: 'Fetch and extract content from a URL that could not be pre-fetched. Use for SPA pages, pages requiring interaction, or URLs marked as needs_subagent.',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to explore.',
          },
          focus: {
            type: 'string',
            description: 'What specific information to look for on the page.',
          },
        },
        required: ['url'],
      },
    },
    handler: async (input, ctx) => {
      const url = String(input.url ?? '')
      if (!url || !url.startsWith('http')) {
        return { success: false, error: 'Valid URL required (http or https)' }
      }

      // SSRF protection
      const blockedPatterns = [
        /^https?:\/\/localhost/i,
        /^https?:\/\/127\.\d+\.\d+\.\d+/,
        /^https?:\/\/10\.\d+\.\d+\.\d+/,
        /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,
        /^https?:\/\/192\.168\.\d+\.\d+/,
        /^https?:\/\/0\.0\.0\.0/,
        /^https?:\/\/169\.254\./,
        /^https?:\/\/metadata\./i,
      ]
      if (blockedPatterns.some(p => p.test(url))) {
        return { success: false, error: 'URL targets a blocked address' }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), WEB_EXPLORE_TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LUNA-Bot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
          },
          redirect: 'follow',
        })

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
        }

        const contentLength = response.headers.get('content-length')
        if (contentLength && Number(contentLength) > WEB_EXPLORE_MAX_SIZE) {
          return { success: false, error: 'Page too large to process' }
        }

        const html = await response.text()
        if (html.length > WEB_EXPLORE_MAX_SIZE) {
          return { success: false, error: 'Page content too large' }
        }

        // Try readability extraction
        const { Readability } = await import('@mozilla/readability')
        const { JSDOM } = await import('jsdom')

        const dom = new JSDOM(html, { url })
        const reader = new Readability(dom.window.document)
        const article = reader.parse()

        const text = article?.textContent?.trim() ?? ''
        if (!text) {
          // Fallback: extract text from body
          const bodyText = dom.window.document.body?.textContent?.trim() ?? ''
          if (!bodyText) {
            return { success: false, error: 'Could not extract readable content from page' }
          }

          const validation = validateInjection(bodyText.slice(0, 8000), 'url', url)
          return {
            success: true,
            data: {
              title: dom.window.document.title || url,
              content: validation.sanitizedText,
              injectionRisk: validation.injectionRisk,
              source: 'body-text-fallback',
            },
          }
        }

        // Validate injection on extracted content
        const maxChars = 8000
        const trimmedText = text.length > maxChars ? text.slice(0, maxChars) + '...' : text
        const validation = validateInjection(trimmedText, 'url', url)

        logger.info({
          url,
          title: article?.title,
          textLength: text.length,
          correlationId: ctx.correlationId,
        }, 'web_explore extracted content')

        return {
          success: true,
          data: {
            title: article?.title || url,
            content: validation.sanitizedText,
            injectionRisk: validation.injectionRisk,
            source: 'readability',
          },
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { success: false, error: 'Request timed out' }
        }
        logger.warn({ url, err }, 'web_explore fetch failed')
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        clearTimeout(timeout)
      }
    },
  })

  logger.info('web_explore tool registered')
}
