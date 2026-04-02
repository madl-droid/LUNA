// LUNA Engine — Skill System
// Skills are behavioral patterns / interaction protocols (NOT tools — tools perform actions).
// The catalog section in the system prompt shows name + short description (stub).
// Full instructions are loaded on-demand when the LLM references a skill by name.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'

const logger = pino({ name: 'engine:skills' })

const SKILLS_DIR = join(process.cwd(), 'instance', 'prompts', 'system', 'skills')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillDefinition {
  /** Unique skill identifier (file name without extension) */
  name: string
  /** Short description for the catalog stub in the system prompt */
  description: string
  /** Path to the full .md instructions file */
  file: string
  /** User types that can trigger this skill (empty = all user types) */
  userTypes: string[]
  /** Optional regex patterns that suggest this skill might be relevant */
  triggerPatterns?: string[]
}

// Skill frontmatter extracted from the first comment block of a .md file.
// Format:
//   <!-- description: Short description here -->
//   <!-- userTypes: lead,admin -->
//   <!-- triggerPatterns: pattern1,pattern2 -->
interface SkillFrontmatter {
  description: string
  userTypes: string[]
  triggerPatterns?: string[]
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const catalogCache: SkillDefinition[] = []
let catalogLoaded = false

const detailCache = new Map<string, string>()

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): SkillFrontmatter {
  const descMatch = content.match(/<!--\s*description:\s*(.+?)\s*-->/)
  const userTypesMatch = content.match(/<!--\s*userTypes:\s*(.+?)\s*-->/)
  const patternsMatch = content.match(/<!--\s*triggerPatterns:\s*(.+?)\s*-->/)

  return {
    description: descMatch?.[1]?.trim() ?? '',
    userTypes: userTypesMatch?.[1]
      ? userTypesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [],
    triggerPatterns: patternsMatch?.[1]
      ? patternsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : undefined,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the skill catalog for a given user type.
 * Returns all skills available to that user type (or all skills if userTypes is empty).
 * Results are cached after first load.
 */
export async function loadSkillCatalog(
  _registry: Registry,
  userType: string,
): Promise<SkillDefinition[]> {
  if (!catalogLoaded) {
    await _loadCatalog()
  }
  if (userType === 'admin') return catalogCache
  return catalogCache.filter(
    s => s.userTypes.length === 0 || s.userTypes.includes(userType),
  )
}

/**
 * Load the full .md content of a single skill.
 * Returns empty string if the skill file is not found.
 */
export async function loadSkillDetail(skillName: string): Promise<string> {
  const cached = detailCache.get(skillName)
  if (cached !== undefined) return cached

  const filePath = join(SKILLS_DIR, `${skillName}.md`)
  try {
    const content = (await readFile(filePath, 'utf-8')).trim()
    detailCache.set(skillName, content)
    return content
  } catch {
    logger.warn({ skillName, filePath }, 'Skill file not found')
    detailCache.set(skillName, '')
    return ''
  }
}

/**
 * Build the <skills> section string for the system prompt.
 * Only includes name + short description (stub) — not the full instructions.
 */
export function buildSkillCatalogSection(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''

  const lines: string[] = [
    '<skills>',
    'Habilidades disponibles (protocolos de interacción especializados):',
    'Para activar una habilidad, menciona su nombre al inicio de tu razonamiento interno.',
  ]

  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`)
  }

  lines.push('</skills>')
  return lines.join('\n')
}

/**
 * Clear the skill catalog cache (for hot-reload).
 */
export function clearSkillCache(): void {
  catalogCache.length = 0
  catalogLoaded = false
  detailCache.clear()
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function _loadCatalog(): Promise<void> {
  try {
    const files = await readdir(SKILLS_DIR)
    const mdFiles = files.filter((f: string) => f.endsWith('.md'))

    for (const file of mdFiles) {
      const name = file.replace(/\.md$/, '')
      const filePath = join(SKILLS_DIR, file)
      try {
        const content = (await readFile(filePath, 'utf-8')).trim()
        const fm = parseFrontmatter(content)
        catalogCache.push({
          name,
          description: fm.description || name,
          file: filePath,
          userTypes: fm.userTypes,
          triggerPatterns: fm.triggerPatterns,
        })
      } catch (err) {
        logger.warn({ file, err }, 'Failed to load skill file')
      }
    }

    catalogLoaded = true
    logger.info({ count: catalogCache.length }, 'Skill catalog loaded')
  } catch {
    // Skills directory doesn't exist yet — not an error
    catalogLoaded = true
    logger.debug({ dir: SKILLS_DIR }, 'Skills directory not found — catalog empty')
  }
}
