// LUNA — Gemini Embedding 2 Limits + Unified Chunk Types
// Single source of truth for embedding constraints and chunk format.
// Used by: knowledge/extractors/smart-chunker.ts, memory/session-chunker.ts, embedding-queue.ts

// ═══════════════════════════════════════════
// Text limits
// ═══════════════════════════════════════════

/** Max tokens per text embedding request (Gemini Embedding 2) */
export const MAX_TEXT_TOKENS = 8192

/** Conservative word equivalent (~8192 tokens ≈ 6000 words) */
export const MAX_TEXT_WORDS = 6000

/** Word overlap between consecutive text chunks */
export const TEXT_OVERLAP_WORDS = 200

/** Minimum words for a chunk to be worth embedding */
export const MIN_CHUNK_WORDS = 20

// ═══════════════════════════════════════════
// Multimodal limits
// ═══════════════════════════════════════════

/** Max images per embedding request */
export const MAX_IMAGES_PER_REQUEST = 6

/** Max PDF pages per embedding request */
export const MAX_PDF_PAGES_PER_REQUEST = 3

/** PDF page overlap between consecutive chunks */
export const PDF_PAGE_OVERLAP = 1

/** Max video duration without audio (seconds) */
export const MAX_VIDEO_NO_AUDIO_SEC = 128

/** Max video duration with audio (seconds) */
export const MAX_VIDEO_WITH_AUDIO_SEC = 80

/** Video overlap between consecutive chunks (seconds) */
export const VIDEO_OVERLAP_SEC = 10

/** Max audio duration per embedding (seconds) */
export const MAX_AUDIO_SEC = 80

/** Audio overlap between consecutive chunks (seconds) */
export const AUDIO_OVERLAP_SEC = 10

// ═══════════════════════════════════════════
// Embedding dimensions
// ═══════════════════════════════════════════

/** Output dimensionality for all embeddings */
export const EMBEDDING_DIMENSIONS = 1536

// ═══════════════════════════════════════════
// Unified chunk types
// ═══════════════════════════════════════════

/** Valid content types for chunks */
export type ChunkContentType =
  | 'text'           // texto plano, docs, transcripciones de audio
  | 'csv'            // tablas/sheets
  | 'pdf_pages'      // páginas de PDF (multimodal)
  | 'slide'          // presentación (multimodal)
  | 'image'          // imagen (multimodal)
  | 'video_frames'   // frames de video (multimodal)
  | 'youtube'        // contenido YouTube (transcript + metadata)
  | 'web'            // contenido web extraído
  | 'drive'          // contenido Drive (leído via API)

/** Reference to a media file for multimodal embedding */
export interface MediaRef {
  mimeType: string
  data?: string       // base64 inline data
  filePath?: string   // on-disk reference
}

/** Rich metadata per chunk — contexto semántico del origen */
export interface ChunkMetadata {
  // Origen
  sourceFile?: string          // "Propuesta Comercial.docx"
  sourceType: string           // 'pdf' | 'docx' | 'audio' | 'drive' | 'web' | 'youtube' | 'session_text' | ...
  sourceMimeType?: string      // 'application/pdf'
  sourceUrl?: string           // URL de origen (web, drive, youtube)

  // Posición en el documento
  pageRange?: string           // "7-12"
  sectionTitle?: string        // "3.2 Presupuesto"

  // Sub-chunks (overflow de una idea que excede el límite)
  parentChunkId?: string       // ID del chunk lógico que se partió
  subChunkIndex?: number       // 0-based position within parent
  subChunkTotal?: number       // total sub-chunks for this parent

  // Contexto
  knowledgeDocId?: string      // si viene de knowledge
  knowledgeItemId?: string
  sessionId?: string           // si viene de memory
  contactId?: string

  // Temporal (audio/video)
  timestampStart?: number      // segundos
  timestampEnd?: number

  // Extra (libre, type-specific)
  [key: string]: unknown
}

/**
 * Pre-linking chunk — produced by chunkers before ID/linking assignment.
 * Both knowledge and memory chunkers produce this format.
 */
export interface EmbeddableChunk {
  // ─── Contenido ───
  content: string | null        // texto del chunk (null si es puro multimodal)
  contentType: ChunkContentType
  mediaRefs: MediaRef[] | null  // binarios para embedding multimodal

  // ─── Linking (set by linkChunks) ───
  chunkIndex: number
  chunkTotal: number
  prevChunkId: string | null
  nextChunkId: string | null

  // ─── Metadata rica ───
  metadata: ChunkMetadata
}

/**
 * Post-linking chunk — with assigned ID and sourceId.
 * Ready for persistence and embedding queue.
 */
export interface LinkedEmbeddableChunk extends EmbeddableChunk {
  id: string
  sourceId: string
}
