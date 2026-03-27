// LUNA — Module: prompts — Template Loader
// Loads and caches system prompt templates from instance/prompts/system/*.md
// Pattern based on src/engine/fallbacks/fallback-loader.ts

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'

const logger = pino({ name: 'prompts:template-loader' })

const SYSTEM_DIR = join(process.cwd(), 'instance', 'prompts', 'system')
const DEFAULTS_DIR = join(process.cwd(), 'instance', 'prompts', 'defaults')

/** In-memory cache of loaded templates (permanent until explicit clear) */
const templateCache = new Map<string, string>()

/**
 * Load a system prompt template by name.
 * Reads from instance/prompts/system/{name}.md, caches permanently.
 */
export async function loadSystemPrompt(name: string): Promise<string> {
  const cached = templateCache.get(name)
  if (cached !== undefined) return cached

  const path = join(SYSTEM_DIR, `${name}.md`)
  try {
    const content = (await readFile(path, 'utf-8')).trim()
    templateCache.set(name, content)
    return content
  } catch {
    logger.warn({ name, path }, 'System prompt template not found')
    templateCache.set(name, '') // Cache miss to avoid repeated file reads
    return ''
  }
}

/**
 * Load a default seed file by name.
 * Reads from instance/prompts/defaults/{name}.md.
 */
export async function loadDefaultPrompt(name: string): Promise<string> {
  const path = join(DEFAULTS_DIR, `${name}.md`)
  try {
    return (await readFile(path, 'utf-8')).trim()
  } catch {
    return ''
  }
}

/**
 * Replace {{key}} placeholders with values from the variables map.
 * Unresolved placeholders are replaced with empty string + warning logged.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  if (!template) return ''

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key]
    if (value !== undefined) return value
    logger.warn({ key }, 'Unresolved template variable')
    return ''
  })
}

/**
 * Preload all system prompt templates into cache at startup.
 */
export async function preloadAll(): Promise<number> {
  try {
    const files = await readdir(SYSTEM_DIR)
    const mdFiles = files.filter((f: string) => f.endsWith('.md'))

    await Promise.all(
      mdFiles.map(async (file: string) => {
        const name = file.replace(/\.md$/, '')
        const path = join(SYSTEM_DIR, file)
        try {
          const content = (await readFile(path, 'utf-8')).trim()
          templateCache.set(name, content)
        } catch (err) {
          logger.warn({ file, err }, 'Failed to preload template')
        }
      }),
    )

    logger.info({ count: mdFiles.length }, 'System prompt templates preloaded')
    return mdFiles.length
  } catch {
    logger.warn('System prompts directory not found, skipping preload')
    return 0
  }
}

/**
 * Clear the template cache (for hot-reload).
 */
export function clearTemplateCache(): void {
  templateCache.clear()
  logger.debug('System prompt template cache cleared')
}

/**
 * List available template names.
 */
export async function listTemplates(): Promise<string[]> {
  try {
    const files = await readdir(SYSTEM_DIR)
    return files.filter((f: string) => f.endsWith('.md')).map((f: string) => f.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

/**
 * Get a template's content (from cache or load).
 * Returns the raw template WITHOUT variable substitution.
 */
export async function getTemplateContent(name: string): Promise<string> {
  return loadSystemPrompt(name)
}
