// LUNA — Module: knowledge — FAQ Manager
// CRUD de FAQs con import desde file (xlsx/csv) o sheets.
// El usuario elige UNA fuente: 'manual' | 'sheets' | 'file'.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeSearchEngine } from './search-engine.js'
import type { KnowledgeCache } from './cache.js'
import type { KnowledgeFAQ, FAQSourceType, KnowledgeConfig } from './types.js'
import { parseFAQsFromXlsx } from './extractors/xlsx.js'

const logger = pino({ name: 'knowledge:faq' })

export class FAQManager {
  constructor(
    private pgStore: KnowledgePgStore,
    private searchEngine: KnowledgeSearchEngine,
    private cache: KnowledgeCache,
    private config: KnowledgeConfig,
    private registry: Registry,
  ) {}

  /**
   * Get the configured FAQ source type.
   */
  getSourceType(): FAQSourceType {
    const src = this.config.KNOWLEDGE_FAQ_SOURCE
    if (src === 'sheets' || src === 'file' || src === 'manual') return src
    return 'manual'
  }

  // ─── Manual CRUD ───────────────────────────

  async createFAQ(data: {
    question: string
    answer: string
    variants?: string[]
    category?: string
  }): Promise<string> {
    const id = await this.pgStore.insertFAQ({
      question: data.question,
      answer: data.answer,
      variants: data.variants ?? [],
      category: data.category ?? null,
      source: 'manual',
    })
    this.invalidateSearch()
    logger.info({ id }, 'FAQ created')
    return id
  }

  async updateFAQ(id: string, updates: {
    question?: string
    answer?: string
    variants?: string[]
    category?: string | null
    active?: boolean
  }): Promise<void> {
    await this.pgStore.updateFAQ(id, updates)
    this.invalidateSearch()
    logger.info({ id }, 'FAQ updated')
  }

  async deleteFAQ(id: string): Promise<void> {
    await this.pgStore.deleteFAQ(id)
    this.invalidateSearch()
    logger.info({ id }, 'FAQ deleted')
  }

  async listFAQs(opts?: {
    category?: string
    search?: string
    limit?: number
    offset?: number
  }): Promise<{ faqs: KnowledgeFAQ[]; total: number }> {
    return this.pgStore.listFAQs(opts)
  }

  // ─── File import (xlsx/csv) ────────────────

  /**
   * Import FAQs from an Excel/CSV file buffer.
   * Replaces ALL existing FAQs (destructive operation).
   */
  async importFromFile(buffer: Buffer): Promise<number> {
    const rows = await parseFAQsFromXlsx(buffer)
    if (rows.length === 0) {
      throw new Error('No valid FAQ rows found in file. Expected columns: question, answer')
    }

    const faqs = rows.map(row => ({
      question: row.question,
      answer: row.answer,
      variants: parseVariants(row.variants),
      category: row.category?.toString().trim() || null,
      source: 'file' as FAQSourceType,
    }))

    // FIX: KN-2 — Wrap delete+insert in transaction to prevent data loss on failure
    const client = await this.pgStore.getPool().connect()
    try {
      await client.query('BEGIN')
      await this.pgStore.deleteAllFAQs(client)
      await this.pgStore.bulkInsertFAQs(faqs, client)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      logger.error({ err }, 'FAQ import failed — rolled back')
      throw err
    } finally {
      client.release()
    }

    this.invalidateSearch()

    logger.info({ count: faqs.length }, 'FAQs imported from file')
    return faqs.length
  }

  // ─── Sheets sync ───────────────────────────

  /**
   * Sync FAQs from a Google Sheet.
   * Requires google:sheets service to be available.
   * Replaces ALL existing FAQs.
   */
  async syncFromSheets(spreadsheetId: string, range = 'A:E'): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheetsService = this.registry.getOptional<any>('google:sheets')
    if (!sheetsService) {
      throw new Error('Google Sheets service not available. Enable google-apps module with sheets service.')
    }

    const data = await sheetsService.readRange(spreadsheetId, range)
    if (!data || !data.values || data.values.length < 2) {
      throw new Error('Sheet is empty or has no data rows')
    }

    // First row is header
    const headers = (data.values[0] as string[]).map((h: string) => h.toLowerCase().trim())
    const rows = data.values.slice(1) as string[][]

    // Map columns
    const qIdx = findColumnIndex(headers, ['question', 'pregunta', 'q'])
    const aIdx = findColumnIndex(headers, ['answer', 'respuesta', 'a', 'r'])

    if (qIdx === -1 || aIdx === -1) {
      throw new Error('Sheet must have "question"/"pregunta" and "answer"/"respuesta" columns')
    }

    const vIdx = findColumnIndex(headers, ['variants', 'variantes', 'alternativas'])
    const cIdx = findColumnIndex(headers, ['category', 'categoría', 'categoria', 'tema'])
    const activeIdx = findColumnIndex(headers, ['active', 'activa', 'activo'])

    // Parse rows
    const faqs: Array<{
      question: string
      answer: string
      variants: string[]
      category: string | null
      source: FAQSourceType
    }> = []

    for (const row of rows) {
      const question = row[qIdx]?.trim()
      const answer = row[aIdx]?.trim()
      if (!question || !answer) continue

      const isActive = activeIdx >= 0
        ? !['no', 'false', '0', 'inactiva', 'inactivo'].includes(row[activeIdx]?.toLowerCase().trim() ?? '')
        : true

      if (!isActive) continue

      faqs.push({
        question,
        answer,
        variants: vIdx >= 0 ? parseVariants(row[vIdx]) : [],
        category: cIdx >= 0 ? (row[cIdx]?.trim() || null) : null,
        source: 'sheets',
      })
    }

    // FIX: KN-2 — Wrap delete+insert in transaction to prevent data loss on failure
    const client = await this.pgStore.getPool().connect()
    let count: number
    try {
      await client.query('BEGIN')
      await this.pgStore.deleteAllFAQs(client)
      count = await this.pgStore.bulkInsertFAQs(faqs, client)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      logger.error({ err }, 'FAQ sheets sync failed — rolled back')
      throw err
    } finally {
      client.release()
    }

    this.invalidateSearch()

    logger.info({ count, spreadsheetId }, 'FAQs synced from Sheets')
    return count
  }

  // ─── Private ───────────────────────────────

  private invalidateSearch(): void {
    void this.searchEngine.invalidateQueryCache().catch(err => {
      logger.warn({ err }, 'Failed to invalidate knowledge search cache')
    })
    void this.cache.invalidate().catch(err => {
      logger.warn({ err }, 'Failed to invalidate knowledge cache')
    })
  }
}

// ─── Helpers ─────────────────────────────────

function parseVariants(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(/[,;|]/).map(v => v.trim()).filter(v => v.length > 0)
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate)
    if (idx >= 0) return idx
  }
  return -1
}
