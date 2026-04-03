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
  /** Tool names required for this skill to appear (empty = always shown) */
  requiredTools?: string[]
}

// Skill frontmatter extracted from the first comment block of a .md file.
// Format:
//   <!-- description: Short description here -->
//   <!-- userTypes: lead,admin -->
//   <!-- requiredTools: tool1,tool2 -->
interface SkillFrontmatter {
  description: string
  userTypes: string[]
  requiredTools?: string[]
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const catalogCache: SkillDefinition[] = []
let catalogLoaded = false

const detailCache = new Map<string, string>()

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): SkillFrontmatter {
  const descMatch = content.match(/<!--\s*description:\s*(.+?)\s*-->/)
  const userTypesMatch = content.match(/<!--\s*userTypes:\s*(.+?)\s*-->/)
  const toolsMatch = content.match(/<!--\s*requiredTools:\s*(.+?)\s*-->/)

  return {
    description: descMatch?.[1]?.trim() ?? '',
    userTypes: userTypesMatch?.[1]
      ? userTypesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [],
    requiredTools: toolsMatch?.[1]
      ? toolsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
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
    'Para aplicar una habilidad, usa la herramienta skill_read para obtener sus instrucciones completas.',
  ]

  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`)
  }

  lines.push('</skills>')
  return lines.join('\n')
}

/**
 * Filter skills to only those relevant to the active tool set.
 * Skills without requiredTools always show.
 * Skills with requiredTools show only if at least one required tool is active.
 */
export function filterSkillsByTools(
  skills: SkillDefinition[],
  activeToolNames: Set<string>,
): SkillDefinition[] {
  return skills.filter(s =>
    !s.requiredTools || s.requiredTools.length === 0 ||
    s.requiredTools.some(t => activeToolNames.has(t)),
  )
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
          requiredTools: fm.requiredTools,
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
