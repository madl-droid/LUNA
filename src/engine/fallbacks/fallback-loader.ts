// LUNA Engine — Fallback Loader
// Loads predefined fallback templates with per-intent + per-channel cascade.
// Cascade: channel/intent → channel/generic → intent → generic → hardcoded

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'

const logger = pino({ name: 'engine:fallback-loader' })

const HARDCODED_FALLBACK = 'Disculpa, estoy teniendo dificultades técnicas en este momento. ¿Podrías intentar de nuevo en unos minutos?'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  content: string | null
  cachedAt: number
}

/** In-memory cache of loaded templates with TTL */
const templateCache = new Map<string, CacheEntry>()

/**
 * Load a fallback template using the cascade:
 * 1. instance/fallbacks/{channel}/{intent}.txt
 * 2. instance/fallbacks/{channel}/generic.txt
 * 3. instance/fallbacks/{intent}.txt
 * 4. instance/fallbacks/generic.txt
 * 5. HARDCODED_FALLBACK
 *
 * Supports placeholders: {{name}}, {{channel}}
 */
export async function loadFallback(
  intent: string,
  channel: string,
  placeholders?: { name?: string; channel?: string },
  fallbackDir?: string,
): Promise<string> {
  const dir = fallbackDir ?? 'instance/fallbacks'

  // Build cascade of paths to try
  const paths: string[] = []
  if (channel) {
    paths.push(join(dir, channel, `${intent}.txt`))
    paths.push(join(dir, channel, 'generic.txt'))
  }
  paths.push(join(dir, `${intent}.txt`))
  paths.push(join(dir, 'generic.txt'))

  for (const path of paths) {
    const content = await loadTemplate(path)
    if (content) {
      return applyPlaceholders(content, placeholders)
    }
  }

  return applyPlaceholders(HARDCODED_FALLBACK, placeholders)
}

/**
 * Load and cache a template file with TTL.
 */
async function loadTemplate(path: string): Promise<string | null> {
  const now = Date.now()
  const cached = templateCache.get(path)

  // Return from cache if within TTL
  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.content
  }

  try {
    const content = await readFile(path, 'utf-8')
    const trimmed = content.trim()
    const result = trimmed || null
    templateCache.set(path, { content: result, cachedAt: now })
    return result
  } catch {
    // File doesn't exist — cache as null with TTL so we re-check later
    templateCache.set(path, { content: null, cachedAt: now })
    return null
  }
}

/**
 * Replace {{name}} and {{channel}} placeholders in template text.
 */
function applyPlaceholders(
  text: string,
  placeholders?: { name?: string; channel?: string },
): string {
  if (!placeholders) return text
  let result = text
  if (placeholders.name) {
    result = result.replace(/\{\{name\}\}/g, placeholders.name)
  } else {
    // Remove name placeholder if no name provided
    result = result.replace(/\{\{name\}\}/g, '')
  }
  if (placeholders.channel) {
    result = result.replace(/\{\{channel\}\}/g, placeholders.channel)
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Clear the template cache (for testing or hot-reload).
 */
export function clearFallbackCache(): void {
  templateCache.clear()
  logger.debug('Fallback template cache cleared')
}
