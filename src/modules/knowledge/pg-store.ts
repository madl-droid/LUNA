// LUNA — Module: knowledge — PostgreSQL Store
// Persistencia: documentos, chunks, FAQs, sync sources.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeFAQ,
  KnowledgeSyncSource,
  KnowledgeCategory,
  SyncFrequency,
  FAQSourceType,
  DocumentSourceType,
  DocumentMetadata,
  KnowledgeStats,
  UpgradeSuggestion,
} from './types.js'

const logger = pino({ name: 'knowledge:pg' })

export class KnowledgePgStore {
  constructor(private db: Pool) {}

  // ─── Migrations ────────────────────────────

  async runMigrations(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title         text NOT NULL,
        category      text NOT NULL DEFAULT 'consultable',
        source_type   text NOT NULL DEFAULT 'upload',
        source_ref    text,
        content_hash  text NOT NULL,
        file_path     text,
        mime_type     text NOT NULL,
        metadata      jsonb NOT NULL DEFAULT '{}',
        chunk_count   int NOT NULL DEFAULT 0,
        hit_count     int NOT NULL DEFAULT 0,
        last_hit_at   timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id   uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        content       text NOT NULL,
        section       text,
        chunk_index   int NOT NULL,
        page          int,
        tsv           tsvector,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `)

    // GIN index on tsvector for Full Text Search
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
        ON knowledge_chunks USING GIN(tsv)
    `)

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc
        ON knowledge_chunks(document_id)
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_faqs (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question      text NOT NULL,
        answer        text NOT NULL,
        variants      text[] NOT NULL DEFAULT '{}',
        category      text,
        source        text NOT NULL DEFAULT 'manual',
        active        boolean NOT NULL DEFAULT true,
        hit_count     int NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_sync_sources (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type              text NOT NULL,
        label             text NOT NULL,
        ref               text NOT NULL,
        frequency         text NOT NULL DEFAULT '24h',
        auto_category     text NOT NULL DEFAULT 'consultable',
        last_sync_at      timestamptz,
        last_sync_status  text,
        file_count        int NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now()
      )
    `)

    // Table for tracking knowledge gaps (queries with no results)
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_gaps (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query       text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    logger.info('Knowledge tables ready')
  }

  // ─── Documents CRUD ────────────────────────

  async insertDocument(doc: {
    title: string
    category: KnowledgeCategory
    sourceType: DocumentSourceType
    sourceRef: string | null
    contentHash: string
    filePath: string | null
    mimeType: string
    metadata: DocumentMetadata
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_documents
        (title, category, source_type, source_ref, content_hash, file_path, mime_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [doc.title, doc.category, doc.sourceType, doc.sourceRef, doc.contentHash,
       doc.filePath, doc.mimeType, JSON.stringify(doc.metadata)],
    )
    return res.rows[0]!.id
  }

  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_documents WHERE id = $1`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapDocRow(row)
  }

  async getDocumentByHash(contentHash: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_documents WHERE content_hash = $1`, [contentHash],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapDocRow(row)
  }

  async getDocumentBySourceRef(sourceRef: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_documents WHERE source_ref = $1`, [sourceRef],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapDocRow(row)
  }

  async listDocuments(opts: {
    category?: KnowledgeCategory
    search?: string
    limit?: number
    offset?: number
  } = {}): Promise<{ documents: KnowledgeDocument[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (opts.category) {
      conditions.push(`category = $${idx++}`)
      params.push(opts.category)
    }
    if (opts.search) {
      conditions.push(`title ILIKE $${idx++}`)
      params.push(`%${opts.search}%`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_documents ${where}`, params,
    )
    const total = parseInt(countRes.rows[0]!.count, 10)

    const dataRes = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_documents ${where}
       ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    )

    return {
      documents: dataRes.rows.map(mapDocRow),
      total,
    }
  }

  async updateDocumentCategory(id: string, category: KnowledgeCategory): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents SET category = $1, updated_at = now() WHERE id = $2`,
      [category, id],
    )
  }

  async updateDocumentHash(id: string, contentHash: string, chunkCount: number): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents
       SET content_hash = $1, chunk_count = $2, updated_at = now()
       WHERE id = $3`,
      [contentHash, chunkCount, id],
    )
  }

  async incrementHitCount(documentId: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents
       SET hit_count = hit_count + 1, last_hit_at = now()
       WHERE id = $1`,
      [documentId],
    )
  }

  async deleteDocument(id: string): Promise<void> {
    // Chunks are CASCADE deleted
    await this.db.query(`DELETE FROM knowledge_documents WHERE id = $1`, [id])
  }

  async getDocumentsForDowngrade(days: number): Promise<KnowledgeDocument[]> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT * FROM knowledge_documents
       WHERE category = 'core'
         AND (
           (hit_count = 0 AND created_at < now() - interval '1 day' * $1)
           OR (last_hit_at IS NOT NULL AND last_hit_at < now() - interval '1 day' * $1)
         )`,
      [days],
    )
    return res.rows.map(mapDocRow)
  }

  // ─── Chunks CRUD ───────────────────────────

  async insertChunks(documentId: string, chunks: Array<{
    content: string
    section: string | null
    chunkIndex: number
    page: number | null
  }>): Promise<void> {
    if (chunks.length === 0) return

    // Delete existing chunks for this doc
    await this.db.query(`DELETE FROM knowledge_chunks WHERE document_id = $1`, [documentId])

    // Insert batch
    const values: string[] = []
    const params: unknown[] = []
    let idx = 1

    for (const chunk of chunks) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, to_tsvector('spanish', $${idx - 4}))`)
      params.push(documentId, chunk.content, chunk.section, chunk.chunkIndex, chunk.page)
    }

    await this.db.query(
      `INSERT INTO knowledge_chunks (document_id, content, section, chunk_index, page, tsv)
       VALUES ${values.join(', ')}`,
      params,
    )

    // Update chunk count
    await this.db.query(
      `UPDATE knowledge_documents SET chunk_count = $1, updated_at = now() WHERE id = $2`,
      [chunks.length, documentId],
    )
  }

  async searchChunksFTS(query: string, category: KnowledgeCategory, limit: number): Promise<Array<{
    chunkId: string
    documentId: string
    content: string
    section: string | null
    score: number
    documentTitle: string
  }>> {
    const res = await this.db.query<{
      chunk_id: string
      document_id: string
      content: string
      section: string | null
      rank: number
      document_title: string
    }>(
      `SELECT
        c.id as chunk_id,
        c.document_id,
        c.content,
        c.section,
        ts_rank(c.tsv, plainto_tsquery('spanish', $1)) as rank,
        d.title as document_title
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.category = $2
         AND c.tsv @@ plainto_tsquery('spanish', $1)
       ORDER BY rank DESC
       LIMIT $3`,
      [query, category, limit],
    )

    return res.rows.map(r => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      section: r.section,
      score: r.rank,
      documentTitle: r.document_title,
    }))
  }

  async getAllChunksByCategory(category: KnowledgeCategory): Promise<Array<{
    content: string
    source: string
    documentId: string
    section: string | null
  }>> {
    const res = await this.db.query<{
      content: string
      title: string
      document_id: string
      section: string | null
    }>(
      `SELECT c.content, d.title, c.document_id, c.section
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.category = $1
       ORDER BY c.document_id, c.chunk_index`,
      [category],
    )
    return res.rows.map(r => ({
      content: r.content,
      source: r.title,
      documentId: r.document_id,
      section: r.section,
    }))
  }

  // ─── FAQs CRUD ─────────────────────────────

  async insertFAQ(faq: {
    question: string
    answer: string
    variants: string[]
    category: string | null
    source: FAQSourceType
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_faqs (question, answer, variants, category, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [faq.question, faq.answer, faq.variants, faq.category, faq.source],
    )
    return res.rows[0]!.id
  }

  async updateFAQ(id: string, updates: {
    question?: string
    answer?: string
    variants?: string[]
    category?: string | null
    active?: boolean
  }): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.question !== undefined) { sets.push(`question = $${idx++}`); params.push(updates.question) }
    if (updates.answer !== undefined) { sets.push(`answer = $${idx++}`); params.push(updates.answer) }
    if (updates.variants !== undefined) { sets.push(`variants = $${idx++}`); params.push(updates.variants) }
    if (updates.category !== undefined) { sets.push(`category = $${idx++}`); params.push(updates.category) }
    if (updates.active !== undefined) { sets.push(`active = $${idx++}`); params.push(updates.active) }

    if (sets.length === 0) return

    sets.push(`updated_at = now()`)
    params.push(id)

    await this.db.query(
      `UPDATE knowledge_faqs SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    )
  }

  async deleteFAQ(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_faqs WHERE id = $1`, [id])
  }

  async deleteAllFAQs(): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_faqs`)
  }

  async listFAQs(opts: {
    category?: string
    search?: string
    activeOnly?: boolean
    limit?: number
    offset?: number
  } = {}): Promise<{ faqs: KnowledgeFAQ[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (opts.category) {
      conditions.push(`category = $${idx++}`)
      params.push(opts.category)
    }
    if (opts.search) {
      conditions.push(`(question ILIKE $${idx} OR answer ILIKE $${idx})`)
      params.push(`%${opts.search}%`)
      idx++
    }
    if (opts.activeOnly) {
      conditions.push('active = true')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_faqs ${where}`, params,
    )
    const total = parseInt(countRes.rows[0]!.count, 10)

    const dataRes = await this.db.query<FAQRow>(
      `SELECT * FROM knowledge_faqs ${where}
       ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    )

    return { faqs: dataRes.rows.map(mapFaqRow), total }
  }

  async getActiveFAQs(): Promise<KnowledgeFAQ[]> {
    const res = await this.db.query<FAQRow>(
      `SELECT * FROM knowledge_faqs WHERE active = true ORDER BY hit_count DESC`,
    )
    return res.rows.map(mapFaqRow)
  }

  async incrementFAQHitCount(id: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_faqs SET hit_count = hit_count + 1 WHERE id = $1`, [id],
    )
  }

  async bulkInsertFAQs(faqs: Array<{
    question: string
    answer: string
    variants: string[]
    category: string | null
    source: FAQSourceType
  }>): Promise<number> {
    if (faqs.length === 0) return 0

    const values: string[] = []
    const params: unknown[] = []
    let idx = 1

    for (const faq of faqs) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`)
      params.push(faq.question, faq.answer, faq.variants, faq.category, faq.source)
    }

    await this.db.query(
      `INSERT INTO knowledge_faqs (question, answer, variants, category, source)
       VALUES ${values.join(', ')}`,
      params,
    )

    return faqs.length
  }

  // ─── Sync sources CRUD ─────────────────────

  async insertSyncSource(src: {
    type: 'drive' | 'url'
    label: string
    ref: string
    frequency: SyncFrequency
    autoCategory: KnowledgeCategory
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_sync_sources (type, label, ref, frequency, auto_category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [src.type, src.label, src.ref, src.frequency, src.autoCategory],
    )
    return res.rows[0]!.id
  }

  async updateSyncSource(id: string, updates: {
    label?: string
    frequency?: SyncFrequency
    autoCategory?: KnowledgeCategory
  }): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.label !== undefined) { sets.push(`label = $${idx++}`); params.push(updates.label) }
    if (updates.frequency !== undefined) { sets.push(`frequency = $${idx++}`); params.push(updates.frequency) }
    if (updates.autoCategory !== undefined) { sets.push(`auto_category = $${idx++}`); params.push(updates.autoCategory) }

    if (sets.length === 0) return
    params.push(id)

    await this.db.query(
      `UPDATE knowledge_sync_sources SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    )
  }

  async deleteSyncSource(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_sync_sources WHERE id = $1`, [id])
  }

  async listSyncSources(): Promise<KnowledgeSyncSource[]> {
    const res = await this.db.query<SyncSourceRow>(
      `SELECT * FROM knowledge_sync_sources ORDER BY created_at DESC`,
    )
    return res.rows.map(mapSyncRow)
  }

  async getSyncSource(id: string): Promise<KnowledgeSyncSource | null> {
    const res = await this.db.query<SyncSourceRow>(
      `SELECT * FROM knowledge_sync_sources WHERE id = $1`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapSyncRow(row)
  }

  async updateSyncStatus(id: string, status: string, fileCount: number): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_sync_sources
       SET last_sync_at = now(), last_sync_status = $1, file_count = $2
       WHERE id = $3`,
      [status, fileCount, id],
    )
  }

  // ─── Gaps ──────────────────────────────────

  async recordGap(query: string): Promise<void> {
    await this.db.query(
      `INSERT INTO knowledge_gaps (query) VALUES ($1)`, [query],
    )
  }

  async getRecentGaps(limit = 20): Promise<string[]> {
    const res = await this.db.query<{ query: string }>(
      `SELECT DISTINCT ON (query) query FROM knowledge_gaps
       ORDER BY query, created_at DESC LIMIT $1`, [limit],
    )
    return res.rows.map(r => r.query)
  }

  async cleanOldGaps(days = 30): Promise<void> {
    await this.db.query(
      `DELETE FROM knowledge_gaps WHERE created_at < now() - interval '1 day' * $1`, [days],
    )
  }

  // ─── Stats ─────────────────────────────────

  async getStats(): Promise<KnowledgeStats> {
    const [docs, chunks, faqs, syncs, top, gaps] = await Promise.all([
      this.db.query<{ total: string; core: string; consultable: string }>(`
        SELECT
          count(*) as total,
          count(*) FILTER (WHERE category = 'core') as core,
          count(*) FILTER (WHERE category = 'consultable') as consultable
        FROM knowledge_documents
      `),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_chunks`),
      this.db.query<{ total: string; active: string }>(`
        SELECT count(*) as total, count(*) FILTER (WHERE active = true) as active
        FROM knowledge_faqs
      `),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_sync_sources`),
      this.db.query<{ id: string; title: string; hit_count: number }>(
        `SELECT id, title, hit_count FROM knowledge_documents ORDER BY hit_count DESC LIMIT 10`,
      ),
      this.getRecentGaps(10),
    ])

    const docRow = docs.rows[0]!
    const faqRow = faqs.rows[0]!

    return {
      totalDocuments: parseInt(docRow.total, 10),
      coreDocuments: parseInt(docRow.core, 10),
      consultableDocuments: parseInt(docRow.consultable, 10),
      totalChunks: parseInt(chunks.rows[0]!.count, 10),
      totalFaqs: parseInt(faqRow.total, 10),
      activeFaqs: parseInt(faqRow.active, 10),
      syncSources: parseInt(syncs.rows[0]!.count, 10),
      topDocuments: top.rows.map(r => ({ id: r.id, title: r.title, hitCount: r.hit_count })),
      recentGaps: gaps,
    }
  }

  // ─── Suggestions ───────────────────────────

  async getUpgradeSuggestions(minHits: number): Promise<UpgradeSuggestion[]> {
    const res = await this.db.query<{
      id: string; title: string; category: string; hit_count: number
    }>(
      `SELECT id, title, category, hit_count FROM knowledge_documents
       WHERE category = 'consultable' AND hit_count >= $1
       ORDER BY hit_count DESC LIMIT 20`,
      [minHits],
    )
    return res.rows.map(r => ({
      documentId: r.id,
      title: r.title,
      category: r.category as KnowledgeCategory,
      hitCount: r.hit_count,
      reason: `Consultado ${r.hit_count} veces — considerar promover a core`,
    }))
  }
}

// ─── Row mappers ─────────────────────────────

interface KnowledgeDocumentRow {
  id: string
  title: string
  category: string
  source_type: string
  source_ref: string | null
  content_hash: string
  file_path: string | null
  mime_type: string
  metadata: DocumentMetadata
  chunk_count: number
  hit_count: number
  last_hit_at: Date | null
  created_at: Date
  updated_at: Date
}

function mapDocRow(r: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: r.id,
    title: r.title,
    category: r.category as KnowledgeCategory,
    sourceType: r.source_type as DocumentSourceType,
    sourceRef: r.source_ref,
    contentHash: r.content_hash,
    filePath: r.file_path,
    mimeType: r.mime_type,
    metadata: r.metadata,
    chunkCount: r.chunk_count,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

interface FAQRow {
  id: string
  question: string
  answer: string
  variants: string[]
  category: string | null
  source: string
  active: boolean
  hit_count: number
  created_at: Date
  updated_at: Date
}

function mapFaqRow(r: FAQRow): KnowledgeFAQ {
  return {
    id: r.id,
    question: r.question,
    answer: r.answer,
    variants: r.variants,
    category: r.category,
    source: r.source as FAQSourceType,
    active: r.active,
    hitCount: r.hit_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

interface SyncSourceRow {
  id: string
  type: string
  label: string
  ref: string
  frequency: string
  auto_category: string
  last_sync_at: Date | null
  last_sync_status: string | null
  file_count: number
  created_at: Date
}

function mapSyncRow(r: SyncSourceRow): KnowledgeSyncSource {
  return {
    id: r.id,
    type: r.type as 'drive' | 'url',
    label: r.label,
    ref: r.ref,
    frequency: r.frequency as SyncFrequency,
    autoCategory: r.auto_category as KnowledgeCategory,
    lastSyncAt: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
    fileCount: r.file_count,
    createdAt: r.created_at,
  }
}
