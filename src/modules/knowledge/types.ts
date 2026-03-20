// LUNA — Module: knowledge — Types
// Interfaces del sistema de base de conocimiento del agente.

// ═══════════════════════════════════════════
// Categorías y frecuencias
// ═══════════════════════════════════════════

export type KnowledgeCategory = 'core' | 'consultable'

export type SyncFrequency = '6h' | '12h' | '24h' | '1w' | '1m'

export type FAQSourceType = 'manual' | 'sheets' | 'file'

export type DocumentSourceType = 'upload' | 'drive' | 'url'

// ═══════════════════════════════════════════
// Frecuencias en milisegundos
// ═══════════════════════════════════════════

export const SYNC_FREQUENCY_MS: Record<SyncFrequency, number> = {
  '6h':  6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '1w':  7 * 24 * 60 * 60 * 1000,
  '1m':  30 * 24 * 60 * 60 * 1000,
}

// ═══════════════════════════════════════════
// Documentos
// ═══════════════════════════════════════════

export interface KnowledgeDocument {
  id: string
  title: string
  category: KnowledgeCategory
  sourceType: DocumentSourceType
  sourceRef: string | null          // Drive file ID, URL, o null para upload
  contentHash: string               // SHA-256 para detectar cambios
  filePath: string | null           // ruta local en instance/knowledge/
  mimeType: string
  metadata: DocumentMetadata
  chunkCount: number
  hitCount: number
  lastHitAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface DocumentMetadata {
  pages?: number
  author?: string
  sizeBytes?: number
  driveModifiedTime?: string        // para comparar en sync
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
  section: string | null            // heading o nombre de sección
  chunkIndex: number
  page: number | null               // para PDFs
  createdAt: Date
}

// ═══════════════════════════════════════════
// FAQs
// ═══════════════════════════════════════════

export interface KnowledgeFAQ {
  id: string
  question: string
  answer: string
  variants: string[]                // formulaciones alternativas
  category: string | null           // tema/grupo
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
  ref: string                       // Drive folder ID o URL
  frequency: SyncFrequency
  autoCategory: KnowledgeCategory
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  fileCount: number
  createdAt: Date
}

// ═══════════════════════════════════════════
// Búsqueda
// ═══════════════════════════════════════════

export interface KnowledgeSearchResult {
  content: string
  source: string                    // nombre del documento o "FAQ"
  score: number                     // 0-1, mayor = mejor
  type: 'chunk' | 'faq'
  documentId?: string
  faqId?: string
}

export interface KnowledgeSearchOptions {
  mode?: KnowledgeCategory          // filtrar por categoría
  limit?: number
  category?: string                 // filtrar FAQs por categoría temática
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
}

// ═══════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════

export interface KnowledgeStats {
  totalDocuments: number
  coreDocuments: number
  consultableDocuments: number
  totalChunks: number
  totalFaqs: number
  activeFaqs: number
  syncSources: number
  topDocuments: Array<{ id: string; title: string; hitCount: number }>
  recentGaps: string[]             // queries sin resultados
}

// ═══════════════════════════════════════════
// Sugerencias de upgrade
// ═══════════════════════════════════════════

export interface UpgradeSuggestion {
  documentId: string
  title: string
  category: KnowledgeCategory
  hitCount: number
  reason: string
}
