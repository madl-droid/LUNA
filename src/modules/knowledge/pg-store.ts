// LUNA — Module: knowledge — PostgreSQL Store v2
// Persistencia: documentos, chunks, FAQs, sync sources, categories, API connectors, web sources.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  KnowledgeDocument,
  KnowledgeFAQ,
  KnowledgeSyncSource,
  KnowledgeCategory,
  KnowledgeApiConnector,
  KnowledgeWebSource,
  KnowledgeItem,
  KnowledgeItemTab,
  KnowledgeItemColumn,
  KnowledgeSourceType,
  FAQSourceType,
  DocumentSourceType,
  DocumentMetadata,
  EmbeddingStatus,
  KnowledgeStats,
  UpgradeSuggestion,
  ApiAuthType,
  ApiAuthConfig,
} from './types.js'

const logger = pino({ name: 'knowledge:pg' })

export class KnowledgePgStore {
  constructor(private db: Pool) {}

  /** Expose pool for transactional use (e.g., FAQ import) */
  getPool(): Pool { return this.db }

  // ─── Migrations ────────────────────────────

  async runMigrations(): Promise<void> {
    // Enable pgvector extension (may already exist from memory module)
    await this.db.query(`CREATE EXTENSION IF NOT EXISTS vector`)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_categories (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title         text NOT NULL,
        description   text NOT NULL DEFAULT '',
        is_default    boolean NOT NULL DEFAULT false,
        position      int NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title             text NOT NULL,
        description       text NOT NULL DEFAULT '',
        is_core           boolean NOT NULL DEFAULT false,
        source_type       text NOT NULL DEFAULT 'upload',
        source_ref        text,
        content_hash      text NOT NULL,
        file_path         text,
        mime_type         text NOT NULL,
        metadata          jsonb NOT NULL DEFAULT '{}',
        chunk_count       int NOT NULL DEFAULT 0,
        hit_count         int NOT NULL DEFAULT 0,
        last_hit_at       timestamptz,
        embedding_status  text NOT NULL DEFAULT 'pending',
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_document_categories (
        document_id   uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        category_id   uuid NOT NULL REFERENCES knowledge_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, category_id)
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
        has_embedding boolean NOT NULL DEFAULT false,
        embedding     vector(1536),
        tsv           tsvector,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv ON knowledge_chunks USING GIN(tsv)`)
    await this.db.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id)`)
    await this.db.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WHERE has_embedding = true`)

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
        auto_category_id  text,
        last_sync_at      timestamptz,
        last_sync_status  text,
        file_count        int NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_gaps (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query       text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_api_connectors (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title               text NOT NULL,
        description         text NOT NULL DEFAULT '',
        base_url            text NOT NULL,
        auth_type           text NOT NULL DEFAULT 'none',
        auth_config         jsonb NOT NULL DEFAULT '{}',
        query_instructions  text NOT NULL DEFAULT '',
        active              boolean NOT NULL DEFAULT true,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_web_sources (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        url                 text NOT NULL,
        title               text NOT NULL,
        description         text NOT NULL DEFAULT '',
        category_id         text,
        cache_hash          text,
        cached_at           timestamptz,
        refresh_frequency   text NOT NULL DEFAULT '24h',
        chunk_count         int NOT NULL DEFAULT 0,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `)

    // ─── Knowledge Items v3 tables ───
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title             text NOT NULL,
        description       text NOT NULL DEFAULT '',
        category_id       uuid REFERENCES knowledge_categories(id) ON DELETE SET NULL,
        source_type       text NOT NULL,
        source_url        text NOT NULL,
        source_id         text NOT NULL,
        is_core           boolean NOT NULL DEFAULT false,
        active            boolean NOT NULL DEFAULT true,
        content_loaded    boolean NOT NULL DEFAULT false,
        embedding_status  text NOT NULL DEFAULT 'pending',
        chunk_count       int NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_item_tabs (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id     uuid NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        tab_name    text NOT NULL,
        description text NOT NULL DEFAULT '',
        position    int NOT NULL DEFAULT 0
      )
    `)

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_item_columns (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tab_id      uuid NOT NULL REFERENCES knowledge_item_tabs(id) ON DELETE CASCADE,
        column_name text NOT NULL,
        description text NOT NULL DEFAULT '',
        position    int NOT NULL DEFAULT 0
      )
    `)

    logger.info('Knowledge tables ready')
  }

  // ─── Documents CRUD ────────────────────────

  async insertDocument(doc: {
    title: string
    description?: string
    isCore?: boolean
    sourceType: DocumentSourceType
    sourceRef: string | null
    contentHash: string
    filePath: string | null
    mimeType: string
    metadata: DocumentMetadata
    category?: KnowledgeCategory
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_documents
        (title, description, is_core, source_type, source_ref, content_hash, file_path, mime_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [doc.title, doc.description ?? '', doc.isCore ?? false, doc.sourceType, doc.sourceRef,
       doc.contentHash, doc.filePath, doc.mimeType, JSON.stringify(doc.metadata)],
    )
    return res.rows[0]!.id
  }

  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE d.id = $1
       GROUP BY d.id`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapDocRow(row)
  }

  async getDocumentByHash(contentHash: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE d.content_hash = $1
       GROUP BY d.id`, [contentHash],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapDocRow(row)
  }

  async getDocumentBySourceRef(sourceRef: string): Promise<KnowledgeDocument | null> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE d.source_ref = $1
       GROUP BY d.id`, [sourceRef],
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

    if (opts.search) {
      conditions.push(`d.title ILIKE $${idx++}`)
      params.push(`%${opts.search}%`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_documents d ${where}`, params,
    )
    const total = parseInt(countRes.rows[0]!.count, 10)

    const dataRes = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       ${where}
       GROUP BY d.id
       ORDER BY d.updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    )

    return {
      documents: dataRes.rows.map(mapDocRow),
      total,
    }
  }

  async updateDocumentHash(id: string, contentHash: string, chunkCount: number): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents
       SET content_hash = $1, chunk_count = $2, updated_at = now()
       WHERE id = $3`,
      [contentHash, chunkCount, id],
    )
  }

  async updateDocumentCore(id: string, isCore: boolean): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents SET is_core = $1, updated_at = now() WHERE id = $2`,
      [isCore, id],
    )
  }

  async updateDocumentEmbeddingStatus(id: string, status: EmbeddingStatus): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents SET embedding_status = $1, updated_at = now() WHERE id = $2`,
      [status, id],
    )
  }

  async getCoreDocumentCount(): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_documents WHERE is_core = true`,
    )
    return parseInt(res.rows[0]!.count, 10)
  }

  async getCoreDocuments(): Promise<KnowledgeDocument[]> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE d.is_core = true
       GROUP BY d.id
       ORDER BY d.title`,
    )
    return res.rows.map(mapDocRow)
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
    await this.db.query(`DELETE FROM knowledge_documents WHERE id = $1`, [id])
  }

  async getDocumentsForDowngrade(days: number): Promise<KnowledgeDocument[]> {
    const res = await this.db.query<KnowledgeDocumentRow>(
      `SELECT d.*, COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids
       FROM knowledge_documents d
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE d.is_core = true
         AND (
           (d.hit_count = 0 AND d.created_at < now() - interval '1 day' * $1)
           OR (d.last_hit_at IS NOT NULL AND d.last_hit_at < now() - interval '1 day' * $1)
         )
       GROUP BY d.id`,
      [days],
    )
    return res.rows.map(mapDocRow)
  }

  // ─── Document Categories ──────────────────

  async assignDocumentCategory(documentId: string, categoryId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO knowledge_document_categories (document_id, category_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [documentId, categoryId],
    )
  }

  // ─── Categories CRUD ─────────────────────

  async listCategories(): Promise<KnowledgeCategory[]> {
    const res = await this.db.query<CategoryRow>(
      `SELECT * FROM knowledge_categories ORDER BY position, created_at`,
    )
    return res.rows.map(mapCategoryRow)
  }

  async ensureDefaultCategory(): Promise<void> {
    const existing = await this.getDefaultCategory()
    if (existing) return
    await this.db.query(
      `INSERT INTO knowledge_categories (title, description, is_default, position) VALUES ('General', 'Categoría por defecto', true, 0)`,
    )
  }

  async getDefaultCategory(): Promise<KnowledgeCategory | null> {
    const res = await this.db.query<CategoryRow>(
      `SELECT * FROM knowledge_categories WHERE is_default = true LIMIT 1`,
    )
    const row = res.rows[0]
    if (!row) return null
    return mapCategoryRow(row)
  }

  async insertCategory(data: { title: string; description?: string }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_categories (title, description) VALUES ($1, $2) RETURNING id`,
      [data.title, data.description ?? ''],
    )
    return res.rows[0]!.id
  }

  async findCategoryByTitle(title: string): Promise<KnowledgeCategory | null> {
    const res = await this.db.query<CategoryRow>(
      `SELECT * FROM knowledge_categories WHERE lower(title) = lower($1) LIMIT 1`,
      [title],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapCategoryRow(row)
  }

  async updateCategory(id: string, updates: { title?: string; description?: string }): Promise<void> {
    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1
    if (updates.title !== undefined) { sets.push(`title = $${idx++}`); vals.push(updates.title) }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(updates.description) }
    if (sets.length === 0) return
    vals.push(id)
    await this.db.query(`UPDATE knowledge_categories SET ${sets.join(', ')} WHERE id = $${idx}`, vals)
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_categories WHERE id = $1 AND is_default = false`, [id])
  }

  // ─── Chunks CRUD ───────────────────────────

  async searchChunksFTS(query: string, limit: number): Promise<Array<{
    chunkId: string
    documentId: string
    content: string
    section: string | null
    rank: number
    documentTitle: string
    categoryIds: string[]
    fileUrl: string | null
  }>> {
    const res = await this.db.query<{
      chunk_id: string
      document_id: string
      content: string
      section: string | null
      rank: number
      document_title: string
      category_ids: string[]
      file_url: string | null
    }>(
      `SELECT
        c.id as chunk_id,
        c.document_id,
        c.content,
        c.section,
        ts_rank(c.tsv, plainto_tsquery('spanish', $1)) as rank,
        d.title as document_title,
        COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids,
        d.metadata->>'fileUrl' as file_url
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE c.tsv @@ plainto_tsquery('spanish', $1)
       GROUP BY c.id, c.document_id, c.content, c.section, c.tsv, d.title, d.metadata
       ORDER BY rank DESC
       LIMIT $2`,
      [query, limit],
    )

    return res.rows.map(r => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      section: r.section,
      rank: r.rank,
      documentTitle: r.document_title,
      categoryIds: r.category_ids,
      fileUrl: r.file_url,
    }))
  }

  async searchChunksVector(embedding: number[], limit: number): Promise<Array<{
    chunkId: string
    documentId: string
    content: string
    section: string | null
    similarity: number
    documentTitle: string
    categoryIds: string[]
    fileUrl: string | null
  }>> {
    const embStr = `[${embedding.join(',')}]`
    const res = await this.db.query<{
      chunk_id: string
      document_id: string
      content: string
      section: string | null
      similarity: number
      document_title: string
      category_ids: string[]
      file_url: string | null
    }>(
      `SELECT
        c.id as chunk_id,
        c.document_id,
        c.content,
        c.section,
        1 - (c.embedding <=> $1::vector) as similarity,
        d.title as document_title,
        COALESCE(array_agg(dc.category_id) FILTER (WHERE dc.category_id IS NOT NULL), '{}') as category_ids,
        d.metadata->>'fileUrl' as file_url
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       LEFT JOIN knowledge_document_categories dc ON dc.document_id = d.id
       WHERE c.embedding_status = 'embedded'
       GROUP BY c.id, c.document_id, c.content, c.section, c.embedding, d.title, d.metadata
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [embStr, limit],
    )

    return res.rows.map(r => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      section: r.section,
      similarity: r.similarity,
      documentTitle: r.document_title,
      categoryIds: r.category_ids,
      fileUrl: r.file_url,
    }))
  }

  async searchFaqsFTS(query: string, limit: number): Promise<Array<{
    faqId: string
    question: string
    answer: string
    rank: number
  }>> {
    const res = await this.db.query<{
      id: string
      question: string
      answer: string
      rank: number
    }>(
      `SELECT id, question, answer,
        ts_rank(to_tsvector('spanish', question || ' ' || answer), plainto_tsquery('spanish', $1)) as rank
       FROM knowledge_faqs
       WHERE active = true
         AND to_tsvector('spanish', question || ' ' || answer) @@ plainto_tsquery('spanish', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [query, limit],
    )

    return res.rows.map(r => ({
      faqId: r.id,
      question: r.question,
      answer: r.answer,
      rank: r.rank,
    }))
  }

  async getChunksWithoutEmbedding(documentId?: string): Promise<Array<{
    id: string
    content: string
    documentId: string
    contentType: string
    mediaRefs: Array<{ mimeType: string; data?: string; filePath?: string }> | null
    extraMetadata: Record<string, unknown> | null
  }>> {
    const cols = 'id, content, document_id, COALESCE(content_type, \'text\') as content_type, media_refs, extra_metadata'
    if (documentId) {
      const res = await this.db.query<{ id: string; content: string; document_id: string; content_type: string; media_refs: unknown; extra_metadata: unknown }>(
        `SELECT ${cols} FROM knowledge_chunks
         WHERE document_id = $1 AND embedding_status != 'embedded'
         ORDER BY chunk_index`,
        [documentId],
      )
      return res.rows.map(r => ({
        id: r.id, content: r.content, documentId: r.document_id,
        contentType: r.content_type,
        mediaRefs: (r.media_refs as Array<{ mimeType: string; data?: string; filePath?: string }>) ?? null,
        extraMetadata: (r.extra_metadata as Record<string, unknown>) ?? null,
      }))
    }

    const res = await this.db.query<{ id: string; content: string; document_id: string; content_type: string; media_refs: unknown; extra_metadata: unknown }>(
      `SELECT ${cols} FROM knowledge_chunks
       WHERE embedding_status != 'embedded'
       ORDER BY document_id, chunk_index`,
    )
    return res.rows.map(r => ({
      id: r.id, content: r.content, documentId: r.document_id,
      contentType: r.content_type,
      mediaRefs: (r.media_refs as Array<{ mimeType: string; data?: string; filePath?: string }>) ?? null,
      extraMetadata: (r.extra_metadata as Record<string, unknown>) ?? null,
    }))
  }

  /** Toggle searchability of all chunks belonging to an item's documents */
  async setItemChunksSearchable(itemId: string, searchable: boolean): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_chunks SET
        has_embedding = CASE WHEN $2 THEN (embedding IS NOT NULL) ELSE false END,
        embedding_status = CASE WHEN $2 AND embedding IS NOT NULL THEN 'embedded' ELSE 'pending' END
       WHERE document_id IN (SELECT id FROM knowledge_documents WHERE source_ref = $1)`,
      [itemId, searchable],
    )
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const embStr = `[${embedding.join(',')}]`
    await this.db.query(
      `UPDATE knowledge_chunks SET embedding = $1::vector, has_embedding = true, embedding_status = 'embedded', retry_count = 0, last_error = NULL, last_attempt_at = NOW() WHERE id = $2`,
      [embStr, chunkId],
    )
  }

  /** Insert smart linked chunks (v2 — type-specific with media refs and linking) */
  async insertLinkedChunks(documentId: string, chunks: import('./types.js').LinkedChunk[]): Promise<void> {
    if (chunks.length === 0) return

    // Delete existing chunks for this document first
    await this.db.query(`DELETE FROM knowledge_chunks WHERE document_id = $1`, [documentId])

    for (const chunk of chunks) {
      await this.db.query(
        `INSERT INTO knowledge_chunks
         (id, document_id, content, section, chunk_index, page, source_id, chunk_total,
          prev_chunk_id, next_chunk_id, content_type, media_refs, extra_metadata, tsv)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, to_tsvector('spanish', $3))`,
        [
          chunk.id,
          documentId,
          chunk.content,
          chunk.section,
          chunk.chunkIndex,
          chunk.page,
          chunk.sourceId,
          chunk.chunkTotal,
          chunk.prevChunkId,
          chunk.nextChunkId,
          chunk.contentType,
          chunk.mediaRefs ? JSON.stringify(chunk.mediaRefs) : null,
          chunk.extraMetadata ? JSON.stringify(chunk.extraMetadata) : null,
        ],
      )
    }
  }

  async getAllChunksByCategory(_category: KnowledgeCategory): Promise<Array<{
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
       ORDER BY c.document_id, c.chunk_index`,
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

  // FIX: KN-2 — Accept optional client for transactional use
  async deleteAllFAQs(client?: import('pg').PoolClient): Promise<void> {
    await (client ?? this.db).query(`DELETE FROM knowledge_faqs`)
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

  // FIX: KN-2 — Accept optional client for transactional use
  async bulkInsertFAQs(faqs: Array<{
    question: string
    answer: string
    variants: string[]
    category: string | null
    source: FAQSourceType
  }>, client?: import('pg').PoolClient): Promise<number> {
    if (faqs.length === 0) return 0

    const values: string[] = []
    const params: unknown[] = []
    let idx = 1

    for (const faq of faqs) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`)
      params.push(faq.question, faq.answer, faq.variants, faq.category, faq.source)
    }

    await (client ?? this.db).query(
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
    autoCategoryId: string | null
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_sync_sources (type, label, ref, auto_category_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [src.type, src.label, src.ref, src.autoCategoryId],
    )
    return res.rows[0]!.id
  }

  async updateSyncSource(id: string, updates: {
    label?: string
    autoCategoryId?: string | null
  }): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.label !== undefined) { sets.push(`label = $${idx++}`); params.push(updates.label) }
    if (updates.autoCategoryId !== undefined) { sets.push(`auto_category_id = $${idx++}`); params.push(updates.autoCategoryId) }

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

  // ─── API Connectors CRUD ──────────────────

  async insertApiConnector(data: Omit<KnowledgeApiConnector, 'id' | 'createdAt' | 'active'>): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_api_connectors (title, description, base_url, auth_type, auth_config, query_instructions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [data.title, data.description, data.baseUrl, data.authType,
       JSON.stringify(data.authConfig), data.queryInstructions],
    )
    return res.rows[0]!.id
  }

  async updateApiConnector(id: string, updates: Partial<KnowledgeApiConnector>): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.title !== undefined) { sets.push(`title = $${idx++}`); params.push(updates.title) }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); params.push(updates.description) }
    if (updates.baseUrl !== undefined) { sets.push(`base_url = $${idx++}`); params.push(updates.baseUrl) }
    if (updates.authType !== undefined) { sets.push(`auth_type = $${idx++}`); params.push(updates.authType) }
    if (updates.authConfig !== undefined) { sets.push(`auth_config = $${idx++}`); params.push(JSON.stringify(updates.authConfig)) }
    if (updates.queryInstructions !== undefined) { sets.push(`query_instructions = $${idx++}`); params.push(updates.queryInstructions) }
    if (updates.active !== undefined) { sets.push(`active = $${idx++}`); params.push(updates.active) }

    if (sets.length === 0) return
    params.push(id)

    await this.db.query(
      `UPDATE knowledge_api_connectors SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    )
  }

  async deleteApiConnector(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_api_connectors WHERE id = $1`, [id])
  }

  async listApiConnectors(): Promise<KnowledgeApiConnector[]> {
    const res = await this.db.query<ApiConnectorRow>(
      `SELECT * FROM knowledge_api_connectors ORDER BY created_at DESC`,
    )
    return res.rows.map(mapApiConnectorRow)
  }

  async getApiConnector(id: string): Promise<KnowledgeApiConnector | null> {
    const res = await this.db.query<ApiConnectorRow>(
      `SELECT * FROM knowledge_api_connectors WHERE id = $1`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapApiConnectorRow(row)
  }

  async countApiConnectors(): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_api_connectors`,
    )
    return parseInt(res.rows[0]!.count, 10)
  }

  // ─── Web Sources CRUD ─────────────────────

  async insertWebSource(data: {
    url: string
    title: string
    description: string
    categoryId: string | null
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_web_sources (url, title, description, category_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.url, data.title, data.description, data.categoryId],
    )
    return res.rows[0]!.id
  }

  async updateWebSource(id: string, updates: Partial<{
    url: string
    title: string
    description: string
    categoryId: string | null
    cacheHash: string
    cachedAt: Date
    chunkCount: number
  }>): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.url !== undefined) { sets.push(`url = $${idx++}`); params.push(updates.url) }
    if (updates.title !== undefined) { sets.push(`title = $${idx++}`); params.push(updates.title) }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); params.push(updates.description) }
    if (updates.categoryId !== undefined) { sets.push(`category_id = $${idx++}`); params.push(updates.categoryId) }
    if (updates.cacheHash !== undefined) { sets.push(`cache_hash = $${idx++}`); params.push(updates.cacheHash) }
    if (updates.cachedAt !== undefined) { sets.push(`cached_at = $${idx++}`); params.push(updates.cachedAt) }
    if (updates.chunkCount !== undefined) { sets.push(`chunk_count = $${idx++}`); params.push(updates.chunkCount) }

    if (sets.length === 0) return
    params.push(id)

    await this.db.query(
      `UPDATE knowledge_web_sources SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    )
  }

  async deleteWebSource(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_web_sources WHERE id = $1`, [id])
  }

  async listWebSources(): Promise<KnowledgeWebSource[]> {
    const res = await this.db.query<WebSourceRow>(
      `SELECT * FROM knowledge_web_sources ORDER BY created_at DESC`,
    )
    return res.rows.map(mapWebSourceRow)
  }

  async getWebSource(id: string): Promise<KnowledgeWebSource | null> {
    const res = await this.db.query<WebSourceRow>(
      `SELECT * FROM knowledge_web_sources WHERE id = $1`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapWebSourceRow(row)
  }

  async countWebSources(): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_web_sources`,
    )
    return parseInt(res.rows[0]!.count, 10)
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
    const [docs, chunks, faqs, syncs, categories, connectors, webSources, top, gaps] = await Promise.all([
      this.db.query<{ total: string; core: string }>(`
        SELECT count(*) as total, count(*) FILTER (WHERE is_core = true) as core
        FROM knowledge_documents
      `),
      this.db.query<{ total: string; embedded: string }>(`
        SELECT count(*) as total, count(*) FILTER (WHERE embedding_status = 'embedded') as embedded
        FROM knowledge_chunks
      `),
      this.db.query<{ total: string; active: string }>(`
        SELECT count(*) as total, count(*) FILTER (WHERE active = true) as active
        FROM knowledge_faqs
      `),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_sync_sources`),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_categories`),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_api_connectors`),
      this.db.query<{ count: string }>(`SELECT count(*) as count FROM knowledge_web_sources`),
      this.db.query<{ id: string; title: string; hit_count: number }>(
        `SELECT id, title, hit_count FROM knowledge_documents ORDER BY hit_count DESC LIMIT 10`,
      ),
      this.getRecentGaps(10),
    ])

    const docRow = docs.rows[0]!
    const chunkRow = chunks.rows[0]!
    const faqRow = faqs.rows[0]!

    return {
      totalDocuments: parseInt(docRow.total, 10),
      coreDocuments: parseInt(docRow.core, 10),
      totalChunks: parseInt(chunkRow.total, 10),
      embeddedChunks: parseInt(chunkRow.embedded, 10),
      totalFaqs: parseInt(faqRow.total, 10),
      activeFaqs: parseInt(faqRow.active, 10),
      syncSources: parseInt(syncs.rows[0]!.count, 10),
      categories: parseInt(categories.rows[0]!.count, 10),
      apiConnectors: parseInt(connectors.rows[0]!.count, 10),
      webSources: parseInt(webSources.rows[0]!.count, 10),
      topDocuments: top.rows.map(r => ({ id: r.id, title: r.title, hitCount: r.hit_count })),
      recentGaps: gaps,
    }
  }

  // ─── Suggestions ───────────────────────────

  // ─── Knowledge Items CRUD ─────────────────

  async insertItem(data: {
    title: string
    description: string
    categoryId: string | null
    sourceType: KnowledgeSourceType
    sourceUrl: string
    sourceId: string
    liveQueryEnabled?: boolean
  }): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO knowledge_items (title, description, category_id, source_type, source_url, source_id, live_query_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [data.title, data.description, data.categoryId, data.sourceType, data.sourceUrl, data.sourceId, data.liveQueryEnabled ?? false],
    )
    return res.rows[0]!.id
  }

  async getItem(id: string): Promise<KnowledgeItem | null> {
    const res = await this.db.query<ItemRow>(
      `SELECT * FROM knowledge_items WHERE id = $1`, [id],
    )
    const row = res.rows[0]
    if (!row) return null
    const item = mapItemRow(row)
    item.tabs = await this.getItemTabs(id)
    return item
  }

  async findItemBySourceId(sourceId: string): Promise<KnowledgeItem | null> {
    const res = await this.db.query<ItemRow>(
      `SELECT * FROM knowledge_items WHERE source_id = $1 LIMIT 1`, [sourceId],
    )
    const row = res.rows[0]
    if (!row) return null
    return mapItemRow(row)
  }

  async listItems(): Promise<KnowledgeItem[]> {
    const res = await this.db.query<ItemRow>(
      `SELECT * FROM knowledge_items ORDER BY created_at DESC`,
    )
    const items = res.rows.map(mapItemRow)
    for (const item of items) {
      item.tabs = await this.getItemTabs(item.id)
    }
    return items
  }

  /** Update last Drive change-detection state (called after each sync check) */
  async updateItemSyncStatus(id: string, checkedAt: Date, modifiedTime: string | null): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_items
       SET last_sync_checked_at = $1, last_modified_time = COALESCE($2, last_modified_time), updated_at = now()
       WHERE id = $3`,
      [checkedAt, modifiedTime, id],
    )
  }

  /** Return active items whose sync interval has elapsed (ready for change check) */
  async listItemsDueForSync(intervalMs: number): Promise<KnowledgeItem[]> {
    const intervalSec = Math.floor(intervalMs / 1000)
    const res = await this.db.query<ItemRow>(`
      SELECT * FROM knowledge_items
      WHERE active = true
        AND (
          last_sync_checked_at IS NULL
          OR last_sync_checked_at < NOW() - ($1 || ' seconds')::interval
        )
      ORDER BY last_sync_checked_at ASC NULLS FIRST
    `, [intervalSec])
    return res.rows.map(mapItemRow)
  }

  /** Toggle ignored flag on a tab */
  async updateTabIgnored(tabId: string, ignored: boolean): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_item_tabs SET ignored = $1 WHERE id = $2`,
      [ignored, tabId],
    )
  }

  /** Toggle ignored flag on a column */
  async updateColumnIgnored(columnId: string, ignored: boolean): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_item_columns SET ignored = $1 WHERE id = $2`,
      [ignored, columnId],
    )
  }

  async updateItem(id: string, updates: {
    title?: string
    description?: string
    categoryId?: string | null
    sourceType?: import('./types.js').KnowledgeSourceType
    isCore?: boolean
    active?: boolean
    contentLoaded?: boolean
    embeddingStatus?: EmbeddingStatus
    chunkCount?: number
    shareable?: boolean
    fullVideoEmbed?: boolean
    liveQueryEnabled?: boolean
  }): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.title !== undefined) { sets.push(`title = $${idx++}`); params.push(updates.title) }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); params.push(updates.description) }
    if (updates.categoryId !== undefined) { sets.push(`category_id = $${idx++}`); params.push(updates.categoryId) }
    if (updates.sourceType !== undefined) { sets.push(`source_type = $${idx++}`); params.push(updates.sourceType) }
    if (updates.isCore !== undefined) { sets.push(`is_core = $${idx++}`); params.push(updates.isCore) }
    if (updates.active !== undefined) { sets.push(`active = $${idx++}`); params.push(updates.active) }
    if (updates.contentLoaded !== undefined) { sets.push(`content_loaded = $${idx++}`); params.push(updates.contentLoaded) }
    if (updates.embeddingStatus !== undefined) { sets.push(`embedding_status = $${idx++}`); params.push(updates.embeddingStatus) }
    if (updates.chunkCount !== undefined) { sets.push(`chunk_count = $${idx++}`); params.push(updates.chunkCount) }
    if (updates.shareable !== undefined) { sets.push(`shareable = $${idx++}`); params.push(updates.shareable) }
    if (updates.fullVideoEmbed !== undefined) { sets.push(`full_video_embed = $${idx++}`); params.push(updates.fullVideoEmbed) }
    if (updates.liveQueryEnabled !== undefined) { sets.push(`live_query_enabled = $${idx++}`); params.push(updates.liveQueryEnabled) }

    if (sets.length === 0) return
    sets.push(`updated_at = now()`)
    params.push(id)

    await this.db.query(
      `UPDATE knowledge_items SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    )
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_items WHERE id = $1`, [id])
  }

  async countCoreItems(): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*) as count FROM knowledge_items WHERE is_core = true`,
    )
    return parseInt(res.rows[0]!.count, 10)
  }

  async getCoreItems(): Promise<KnowledgeItem[]> {
    const res = await this.db.query<ItemRow>(
      `SELECT * FROM knowledge_items WHERE is_core = true AND active = true ORDER BY title`,
    )
    return res.rows.map(mapItemRow)
  }

  /** Return active items for Phase 1 injection — lightweight, no tabs/columns */
  async listActiveItemsForInjection(): Promise<Pick<KnowledgeItem, 'id' | 'title' | 'description' | 'categoryId' | 'shareable' | 'sourceUrl' | 'liveQueryEnabled' | 'sourceId' | 'sourceType'>[]> {
    const res = await this.db.query<{ id: string; title: string; description: string; category_id: string | null; shareable: boolean; source_url: string; live_query_enabled: boolean; source_id: string; source_type: string }>(
      `SELECT id, title, description, category_id, shareable, source_url, live_query_enabled, source_id, source_type
       FROM knowledge_items
       WHERE active = true
       ORDER BY title`,
    )
    return res.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      categoryId: row.category_id,
      shareable: row.shareable ?? false,
      sourceUrl: row.source_url,
      liveQueryEnabled: row.live_query_enabled ?? false,
      sourceId: row.source_id,
      sourceType: row.source_type as import('./types.js').KnowledgeSourceType,
    }))
  }

  /** Return active items that need content loading or re-embedding (for nightly scan) */
  async listItemsNeedingEmbedding(): Promise<KnowledgeItem[]> {
    const res = await this.db.query<ItemRow>(
      `SELECT * FROM knowledge_items
       WHERE active = true
         AND (content_loaded = false OR embedding_status NOT IN ('done', 'processing'))
       ORDER BY created_at ASC`,
    )
    return res.rows.map(mapItemRow)
  }

  // ─── Item Tabs CRUD ─────────────────────

  async getItemTabs(itemId: string): Promise<KnowledgeItemTab[]> {
    const res = await this.db.query<ItemTabRow>(
      `SELECT * FROM knowledge_item_tabs WHERE item_id = $1 ORDER BY position`, [itemId],
    )
    const tabs = res.rows.map(mapItemTabRow)
    for (const tab of tabs) {
      tab.columns = await this.getTabColumns(tab.id)
    }
    return tabs
  }

  async replaceItemTabs(itemId: string, tabs: Array<{ tabName: string; description: string; position: number; ignored?: boolean }>): Promise<string[]> {
    await this.db.query(`DELETE FROM knowledge_item_tabs WHERE item_id = $1`, [itemId])
    const ids: string[] = []
    for (const tab of tabs) {
      const res = await this.db.query<{ id: string }>(
        `INSERT INTO knowledge_item_tabs (item_id, tab_name, description, position, ignored)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [itemId, tab.tabName, tab.description, tab.position, tab.ignored ?? false],
      )
      ids.push(res.rows[0]!.id)
    }
    return ids
  }

  async updateTabDescription(tabId: string, description: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_item_tabs SET description = $1 WHERE id = $2`,
      [description, tabId],
    )
  }

  // ─── Item Columns CRUD ──────────────────

  async getTabColumns(tabId: string): Promise<KnowledgeItemColumn[]> {
    const res = await this.db.query<ItemColumnRow>(
      `SELECT * FROM knowledge_item_columns WHERE tab_id = $1 ORDER BY position`, [tabId],
    )
    return res.rows.map(mapItemColumnRow)
  }

  async replaceTabColumns(tabId: string, columns: Array<{ columnName: string; description: string; position: number; ignored?: boolean }>): Promise<void> {
    await this.db.query(`DELETE FROM knowledge_item_columns WHERE tab_id = $1`, [tabId])
    for (const col of columns) {
      await this.db.query(
        `INSERT INTO knowledge_item_columns (tab_id, column_name, description, position, ignored)
         VALUES ($1, $2, $3, $4, $5)`,
        [tabId, col.columnName, col.description, col.position, col.ignored ?? false],
      )
    }
  }

  async updateColumnDescription(columnId: string, description: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_item_columns SET description = $1 WHERE id = $2`,
      [description, columnId],
    )
  }

  // ─── Item Chunks (linked via source_ref to knowledge_documents) ──

  async deleteItemChunks(itemId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM knowledge_chunks WHERE document_id IN (
        SELECT id FROM knowledge_documents WHERE source_ref = $1
      )`, [itemId],
    )
    await this.db.query(
      `DELETE FROM knowledge_documents WHERE source_ref = $1`, [itemId],
    )
  }

  async getUpgradeSuggestions(minHits: number): Promise<UpgradeSuggestion[]> {
    const res = await this.db.query<{
      id: string; title: string; is_core: boolean; hit_count: number
    }>(
      `SELECT id, title, is_core, hit_count FROM knowledge_documents
       WHERE is_core = false AND hit_count >= $1
       ORDER BY hit_count DESC LIMIT 20`,
      [minHits],
    )
    return res.rows.map(r => ({
      documentId: r.id,
      title: r.title,
      isCore: r.is_core,
      hitCount: r.hit_count,
      reason: `Consultado ${r.hit_count} veces — considerar promover a core`,
    }))
  }

  async getDemotionSuggestions(maxDays: number): Promise<Array<{
    documentId: string; title: string; hitCount: number;
    lastHitAt: Date | null; createdAt: Date; reason: string;
  }>> {
    const res = await this.db.query<{
      id: string; title: string; hit_count: number; last_hit_at: Date | null; created_at: Date
    }>(
      `SELECT id, title, hit_count, last_hit_at, created_at
       FROM knowledge_documents
       WHERE is_core = true
         AND (hit_count = 0 AND created_at < NOW() - INTERVAL '1 day' * $1
              OR last_hit_at < NOW() - INTERVAL '1 day' * $1)
       ORDER BY hit_count ASC
       LIMIT 20`,
      [maxDays],
    )
    return res.rows.map((r: { id: string; title: string; hit_count: number; last_hit_at: Date | null; created_at: Date }) => ({
      documentId: r.id,
      title: r.title,
      hitCount: r.hit_count,
      lastHitAt: r.last_hit_at,
      createdAt: r.created_at,
      reason: r.hit_count === 0
        ? `Documento core sin consultas en ${maxDays} días`
        : `Última consulta hace más de ${maxDays} días (${r.hit_count} consultas totales)`,
    }))
  }

  // ─── Item approve/reject (pending_review → pending/inactive) ───

  async approveItem(itemId: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_items SET embedding_status = 'pending', updated_at = NOW()
       WHERE id = $1 AND embedding_status = 'pending_review'`,
      [itemId],
    )
  }

  async rejectItem(itemId: string): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_items SET active = false, updated_at = NOW()
       WHERE id = $1 AND embedding_status = 'pending_review'`,
      [itemId],
    )
  }

  // ─── LLM description management ────────────────

  async updateDocumentLlmDescription(
    documentId: string,
    llmDescription: string,
    keywords: string[],
  ): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_documents
       SET llm_description = $2, keywords = $3, updated_at = now()
       WHERE id = $1`,
      [documentId, llmDescription, keywords],
    )
  }

  async updateItemLlmDescription(
    itemId: string,
    llmDescription: string,
    keywords: string[],
  ): Promise<void> {
    await this.db.query(
      `UPDATE knowledge_items
       SET llm_description = $2, keywords = $3, updated_at = now()
       WHERE id = $1`,
      [itemId, llmDescription, keywords],
    )
  }

  async getDocumentChunkSamples(documentId: string): Promise<Array<{
    content: string; section: string | null; contentType: string
    chunkIndex: number; chunkTotal: number
  }>> {
    const totalRes = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM knowledge_chunks WHERE document_id = $1`,
      [documentId],
    )
    const total = totalRes.rows[0]?.cnt ?? 0

    const res = await this.db.query<{
      content: string; section: string | null; content_type: string; chunk_index: number
    }>(
      `SELECT content, section, COALESCE(content_type, 'text') AS content_type, chunk_index
       FROM knowledge_chunks WHERE document_id = $1
       ORDER BY chunk_index ASC`,
      [documentId],
    )

    return res.rows.map(r => ({
      content: r.content,
      section: r.section,
      contentType: r.content_type,
      chunkIndex: r.chunk_index,
      chunkTotal: total,
    }))
  }
}

// ─── Row mappers ─────────────────────────────

interface KnowledgeDocumentRow {
  id: string
  title: string
  description: string
  llm_description: string | null
  keywords: string[] | null
  is_core: boolean
  source_type: string
  source_ref: string | null
  content_hash: string
  file_path: string | null
  mime_type: string
  metadata: DocumentMetadata
  chunk_count: number
  hit_count: number
  last_hit_at: Date | null
  embedding_status: string
  category_ids: string[]
  created_at: Date
  updated_at: Date
}

function mapDocRow(r: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    llmDescription: r.llm_description ?? null,
    keywords: r.keywords ?? [],
    isCore: r.is_core,
    sourceType: r.source_type as DocumentSourceType,
    sourceRef: r.source_ref,
    contentHash: r.content_hash,
    filePath: r.file_path,
    mimeType: r.mime_type,
    metadata: r.metadata,
    chunkCount: r.chunk_count,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
    embeddingStatus: r.embedding_status as EmbeddingStatus,
    categoryIds: r.category_ids,
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
  auto_category_id: string | null
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
    autoCategoryId: r.auto_category_id,
    lastSyncAt: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
    fileCount: r.file_count,
    createdAt: r.created_at,
  }
}

interface CategoryRow {
  id: string
  title: string
  description: string
  is_default: boolean
  position: number
  created_at: Date
}

function mapCategoryRow(r: CategoryRow): KnowledgeCategory {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    isDefault: r.is_default,
    position: r.position,
    createdAt: r.created_at,
  }
}

interface ApiConnectorRow {
  id: string
  title: string
  description: string
  base_url: string
  auth_type: string
  auth_config: ApiAuthConfig
  query_instructions: string
  active: boolean
  created_at: Date
}

function mapApiConnectorRow(r: ApiConnectorRow): KnowledgeApiConnector {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    baseUrl: r.base_url,
    authType: r.auth_type as ApiAuthType,
    authConfig: r.auth_config,
    queryInstructions: r.query_instructions,
    active: r.active,
    createdAt: r.created_at,
  }
}

interface WebSourceRow {
  id: string
  url: string
  title: string
  description: string
  category_id: string | null
  cache_hash: string | null
  cached_at: Date | null
  chunk_count: number
  created_at: Date
}

function mapWebSourceRow(r: WebSourceRow): KnowledgeWebSource {
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    description: r.description,
    categoryId: r.category_id,
    cacheHash: r.cache_hash,
    cachedAt: r.cached_at,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }
}

// ─── Knowledge Items row mappers ────────────

interface ItemRow {
  id: string
  title: string
  description: string
  category_id: string | null
  source_type: string
  source_url: string
  source_id: string
  is_core: boolean
  active: boolean
  content_loaded: boolean
  embedding_status: string
  chunk_count: number
  last_sync_checked_at: Date | null
  last_modified_time: string | null
  shareable: boolean
  full_video_embed: boolean
  live_query_enabled: boolean
  created_at: Date
  updated_at: Date
}

function mapItemRow(r: ItemRow): KnowledgeItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryId: r.category_id,
    sourceType: r.source_type as KnowledgeSourceType,
    sourceUrl: r.source_url,
    sourceId: r.source_id,
    isCore: r.is_core,
    active: r.active,
    contentLoaded: r.content_loaded,
    embeddingStatus: r.embedding_status as EmbeddingStatus,
    chunkCount: r.chunk_count,
    lastSyncCheckedAt: r.last_sync_checked_at ?? null,
    lastModifiedTime: r.last_modified_time ?? null,
    shareable: r.shareable ?? false,
    fullVideoEmbed: r.full_video_embed ?? false,
    liveQueryEnabled: r.live_query_enabled ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

interface ItemTabRow {
  id: string
  item_id: string
  tab_name: string
  description: string
  position: number
  ignored: boolean
}

function mapItemTabRow(r: ItemTabRow): KnowledgeItemTab {
  return {
    id: r.id,
    itemId: r.item_id,
    tabName: r.tab_name,
    description: r.description,
    position: r.position,
    ignored: r.ignored ?? false,
  }
}

interface ItemColumnRow {
  id: string
  tab_id: string
  column_name: string
  description: string
  position: number
  ignored: boolean
}

function mapItemColumnRow(r: ItemColumnRow): KnowledgeItemColumn {
  return {
    id: r.id,
    tabId: r.tab_id,
    columnName: r.column_name,
    description: r.description,
    position: r.position,
    ignored: r.ignored ?? false,
  }
}
