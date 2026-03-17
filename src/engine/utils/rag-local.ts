// LUNA Engine — Local RAG with fuse.js
// Búsqueda fuzzy sobre archivos de texto en instance/knowledge/.

import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import Fuse from 'fuse.js'
import pino from 'pino'
import type { KnowledgeMatch } from '../types.js'

const logger = pino({ name: 'engine:rag' })

interface KnowledgeEntry {
  content: string
  source: string
}

let knowledgeIndex: Fuse<KnowledgeEntry> | null = null
let lastLoadTime = 0
const RELOAD_INTERVAL_MS = 5 * 60 * 1000  // reload every 5 minutes

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json'])

/**
 * Load knowledge files from directory into fuse.js index.
 */
async function loadKnowledge(knowledgeDir: string): Promise<Fuse<KnowledgeEntry>> {
  const entries: KnowledgeEntry[] = []

  try {
    const files = await readdir(knowledgeDir, { recursive: true })

    for (const file of files) {
      const filePath = typeof file === 'string' ? file : String(file)
      const ext = extname(filePath).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue
      // Skip media directory
      if (filePath.startsWith('media/') || filePath.startsWith('media\\')) continue

      try {
        const fullPath = join(knowledgeDir, filePath)
        const content = await readFile(fullPath, 'utf-8')

        // Split long files into paragraphs/sections
        const chunks = splitIntoChunks(content, filePath)
        entries.push(...chunks)
      } catch (err) {
        logger.warn({ file: filePath, err }, 'Failed to read knowledge file')
      }
    }
  } catch (err) {
    logger.warn({ dir: knowledgeDir, err }, 'Failed to read knowledge directory')
  }

  logger.info({ entries: entries.length, dir: knowledgeDir }, 'Knowledge index loaded')

  return new Fuse(entries, {
    keys: ['content'],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })
}

/**
 * Split content into searchable chunks (by paragraph or heading).
 */
function splitIntoChunks(content: string, source: string): KnowledgeEntry[] {
  // Split by double newlines or markdown headings
  const sections = content.split(/\n\s*\n|(?=^#{1,3}\s)/m)
  const chunks: KnowledgeEntry[] = []

  for (const section of sections) {
    const trimmed = section.trim()
    if (trimmed.length < 20) continue  // skip very short sections
    if (trimmed.length > 2000) {
      // Further split long sections
      for (let i = 0; i < trimmed.length; i += 1500) {
        chunks.push({ content: trimmed.substring(i, i + 1500), source })
      }
    } else {
      chunks.push({ content: trimmed, source })
    }
  }

  return chunks
}

/**
 * Search knowledge base for relevant content.
 */
export async function searchKnowledge(
  query: string,
  knowledgeDir: string,
  maxResults = 3,
): Promise<KnowledgeMatch[]> {
  const now = Date.now()

  // Reload if stale or not loaded
  if (!knowledgeIndex || now - lastLoadTime > RELOAD_INTERVAL_MS) {
    knowledgeIndex = await loadKnowledge(knowledgeDir)
    lastLoadTime = now
  }

  if (!query.trim()) return []

  const results = knowledgeIndex.search(query, { limit: maxResults })

  return results.map(r => ({
    content: r.item.content,
    source: r.item.source,
    score: 1 - (r.score ?? 0),  // fuse.js score is 0=perfect, invert for our use
  }))
}

/**
 * Force reload the knowledge index.
 */
export async function reloadKnowledge(knowledgeDir: string): Promise<void> {
  knowledgeIndex = await loadKnowledge(knowledgeDir)
  lastLoadTime = Date.now()
}
