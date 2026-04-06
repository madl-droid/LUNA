// LUNA — Gemini Embedding 2 Limits
// Single source of truth for embedding constraints.
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
export const MAX_PDF_PAGES_PER_REQUEST = 6

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
