// LUNA — Module: knowledge — Types v2
// Interfaces del sistema de base de conocimiento del agente.
// v2: categorías como tabla, embeddings, API connectors, web sources.

// ═══════════════════════════════════════════
// Frecuencias y source types
// ═══════════════════════════════════════════

export type SyncFrequency = '6h' | '12h' | '24h' | '1w' | '1m'

export type FAQSourceType = 'manual' | 'sheets' | 'file'

export type DocumentSourceType = 'upload' | 'drive' | 'url' | 'web'

export type EmbeddingStatus = 'pending' | 'processing' | 'done' | 'failed'

// Frecuencias en milisegundos
export const SYNC_FREQUENCY_MS: Record<SyncFrequency, number> = {
  '6h':  6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '1w':  7 * 24 * 60 * 60 * 1000,
  '1m':  30 * 24 * 60 * 60 * 1000,
}

// ═══════════════════════════════════════════
// Categorías (tabla propia, max 25)
// ═══════════════════════════════════════════

export interface KnowledgeCategory {
  id: string
  title: string               // max 60 chars
  description: string         // max 200 chars
  isDefault: boolean
  position: number
  createdAt: Date
}

// ═══════════════════════════════════════════
// Documentos
// ═══════════════════════════════════════════

export interface KnowledgeDocument {
  id: string
  title: string
  description: string         // max 200 chars — breve descripción para catálogo
  isCore: boolean             // flag separado (max 3 docs core)
  sourceType: DocumentSourceType
  sourceRef: string | null    // Drive file ID, URL, o null para upload
  contentHash: string         // SHA-256 para detectar cambios
  filePath: string | null     // ruta local en instance/knowledge/
  mimeType: string
  metadata: DocumentMetadata
  chunkCount: number
  hitCount: number
  lastHitAt: Date | null
  embeddingStatus: EmbeddingStatus
  categoryIds: string[]       // IDs de categorías asignadas
  createdAt: Date
  updatedAt: Date
}

export interface DocumentMetadata {
  pages?: number
  author?: string
  sizeBytes?: number
  driveModifiedTime?: string  // para comparar en sync
  originalName?: string
  extractorUsed?: string
  [key: string]: unknown
}

// ═══════════════════════════════════════════
// Chunks
// ═══════════════════════════════════════════

export interface KnowledgeChunk {
  id: string
  documentId: string
  content: string
  section: string | null      // heading o nombre de sección
  chunkIndex: number
  page: number | null         // para PDFs
  hasEmbedding: boolean
  createdAt: Date
}

// ═══════════════════════════════════════════
// FAQs
// ═══════════════════════════════════════════

export interface KnowledgeFAQ {
  id: string
  question: string
  answer: string
  variants: string[]          // formulaciones alternativas
  category: string | null     // tema/grupo
  source: FAQSourceType
  active: boolean
  hitCount: number
  createdAt: Date
  updatedAt: Date
}

export interface FAQImportRow {
  question: string
  answer: string
  variants?: string
  category?: string
  active?: boolean | string
}

// ═══════════════════════════════════════════
// Sync sources
// ═══════════════════════════════════════════

export interface KnowledgeSyncSource {
  id: string
  type: 'drive' | 'url'
  label: string
  ref: string                 // Drive folder ID o URL
  frequency: SyncFrequency
  autoCategoryId: string | null  // ID de categoría por defecto
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  fileCount: number
  createdAt: Date
}

// ═══════════════════════════════════════════
// API Connectors (read-only, max 10)
// ═══════════════════════════════════════════

export type ApiAuthType = 'none' | 'bearer' | 'api_key' | 'basic'

export interface ApiAuthConfig {
  token?: string
  apiKey?: string
  apiKeyHeader?: string       // default: X-API-Key
  username?: string
  password?: string
}

export interface KnowledgeApiConnector {
  id: string
  title: string               // max 60 chars
  description: string         // max 200 chars
  baseUrl: string
  authType: ApiAuthType
  authConfig: ApiAuthConfig
  queryInstructions: string   // instructions for LLM on how to use
  active: boolean
  createdAt: Date
}

// ═══════════════════════════════════════════
// Web Sources (cached, max 3)
// ═══════════════════════════════════════════

export interface KnowledgeWebSource {
  id: string
  url: string
  title: string               // max 60 chars
  description: string         // max 200 chars
  categoryId: string | null   // FK → categories
  cacheHash: string | null    // SHA-256 of last cached content
  cachedAt: Date | null
  refreshFrequency: SyncFrequency
  chunkCount: number
  createdAt: Date
}

// ═══════════════════════════════════════════
// Knowledge Injection (Phase 1 output)
// ═══════════════════════════════════════════

export interface KnowledgeInjectionItem {
  id: string
  title: string
  description: string
  categoryId: string | null
  categoryTitle?: string
  shareable?: boolean
  sourceUrl?: string
}

export interface KnowledgeInjection {
  coreDocuments: Array<{ title: string; description: string }>
  categories: Array<{ id: string; title: string; description: string }>
  apiConnectors: Array<{ title: string; description: string }>
  /** Active knowledge items grouped for evaluator catalog (v3) */
  items: KnowledgeInjectionItem[]
}

// ═══════════════════════════════════════════
// Búsqueda
// ═══════════════════════════════════════════

export interface KnowledgeSearchResult {
  content: string
  source: string              // nombre del documento o "FAQ"
  score: number               // 0-1, mayor = mejor
  type: 'chunk' | 'faq'
  documentId?: string
  faqId?: string
}

export interface KnowledgeSearchOptions {
  limit?: number
  searchHint?: string         // título de categoría para boost
}

// ═══════════════════════════════════════════
// Vectorize job data (BullMQ)
// ═══════════════════════════════════════════

export type VectorizeJobType = 'document' | 'bulk'

export interface VectorizeJobData {
  type: VectorizeJobType
  documentId?: string         // for type=document
}

// ═══════════════════════════════════════════
// Extractores
// ═══════════════════════════════════════════

export interface ExtractedContent {
  text: string
  sections: ExtractedSection[]
  metadata: DocumentMetadata
}

export interface ExtractedSection {
  title: string | null
  content: string
  page?: number
}

export type ExtractorFn = (input: Buffer, fileName: string) => Promise<ExtractedContent>

// ═══════════════════════════════════════════
// Config del módulo (parsed from configSchema)
// ═══════════════════════════════════════════

export interface KnowledgeConfig {
  KNOWLEDGE_DIR: string
  KNOWLEDGE_MAX_FILE_SIZE_MB: number
  KNOWLEDGE_CORE_MAX_CHUNKS: number
  KNOWLEDGE_CACHE_TTL_MIN: number
  KNOWLEDGE_AUTO_DOWNGRADE_DAYS: number
  KNOWLEDGE_FAQ_SOURCE: string
  KNOWLEDGE_SYNC_ENABLED: boolean
  KNOWLEDGE_GOOGLE_AI_API_KEY: string
  KNOWLEDGE_EMBEDDING_ENABLED: boolean
  KNOWLEDGE_VECTORIZE_CONCURRENCY: number
  KNOWLEDGE_MAX_WEB_SOURCES: number
  KNOWLEDGE_MAX_API_CONNECTORS: number
  KNOWLEDGE_MAX_CATEGORIES: number
  KNOWLEDGE_MAX_CORE_DOCS: number
}

// ═══════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════

export interface KnowledgeStats {
  totalDocuments: number
  coreDocuments: number
  totalChunks: number
  embeddedChunks: number
  totalFaqs: number
  activeFaqs: number
  syncSources: number
  categories: number
  apiConnectors: number
  webSources: number
  topDocuments: Array<{ id: string; title: string; hitCount: number }>
  recentGaps: string[]
}

// ═══════════════════════════════════════════
// Sugerencias de upgrade
// ═══════════════════════════════════════════

export interface UpgradeSuggestion {
  documentId: string
  title: string
  isCore: boolean
  hitCount: number
  reason: string
}

// ═══════════════════════════════════════════
// Knowledge Items (v3 — Google Sheets/Docs/Drive sources)
// ═══════════════════════════════════════════

export type KnowledgeSourceType = 'sheets' | 'docs' | 'slides' | 'drive' | 'pdf' | 'youtube'

export interface KnowledgeItem {
  id: string
  title: string
  description: string
  categoryId: string | null
  sourceType: KnowledgeSourceType
  sourceUrl: string
  sourceId: string              // extracted Google resource ID
  isCore: boolean
  active: boolean
  contentLoaded: boolean
  embeddingStatus: EmbeddingStatus
  chunkCount: number
  updateFrequency: SyncFrequency   // how often to check for changes
  lastSyncCheckedAt: Date | null   // last Drive modifiedTime check
  lastModifiedTime: string | null  // last known Drive modifiedTime
  shareable: boolean              // agent can share the source URL with users
  createdAt: Date
  updatedAt: Date
  tabs?: KnowledgeItemTab[]
}

export interface KnowledgeItemTab {
  id: string
  itemId: string
  tabName: string
  description: string
  position: number
  ignored: boolean              // skip this tab during embedding
  columns?: KnowledgeItemColumn[]
}

export interface KnowledgeItemColumn {
  id: string
  tabId: string
  columnName: string
  description: string
  position: number
  ignored: boolean              // skip this column during row text building
}
