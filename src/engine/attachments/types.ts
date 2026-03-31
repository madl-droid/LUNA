// LUNA Engine — Attachment Processing Types
// Types for the cross-channel attachment processing subsystem.

/** Categories of attachments supported by the system */
export type AttachmentCategory =
  | 'documents'
  | 'spreadsheets'
  | 'images'
  | 'audio'
  | 'presentations'
  | 'text'
  | 'web_link'

/** Per-channel attachment configuration */
export interface ChannelAttachmentConfig {
  enabledCategories: AttachmentCategory[]
  maxFileSizeMb: number
  maxAttachmentsPerMessage: number
}

/** Size tier for tiered document injection */
export type AttachmentSizeTier = 'small' | 'medium' | 'large'

/** Source type for DB tracking */
export type AttachmentSourceType =
  | 'file_attachment'
  | 'audio_transcription'
  | 'url_extraction'
  | 'image_vision'

/** Status of an attachment after processing */
export type AttachmentStatus =
  | 'processed'
  | 'cached'
  | 'extraction_failed'
  | 'too_large'
  | 'system_limit_exceeded'
  | 'disabled_by_channel'
  | 'unsupported_type'
  | 'needs_subagent'

/** Category label for injection into conversation context */
export const CATEGORY_LABEL_MAP: Record<AttachmentCategory, string> = {
  documents: 'PDF/DOC',
  spreadsheets: 'Hoja de cálculo',
  images: 'Imagen',
  audio: 'Audio',
  presentations: 'Presentación',
  text: 'TXT/MD',
  web_link: 'Enlace web',
}

/** Threshold tokens for small vs large classification (~8192 tokens ≈ Gemini Embedding 2 limit) */
export const SMALL_FILE_TOKEN_THRESHOLD = 8192

/** A fully processed attachment ready for context injection */
export interface ProcessedAttachment {
  id: string
  filename: string
  mimeType: string
  category: AttachmentCategory
  sizeBytes: number
  /** Code-processed text (for embeddings and storage) */
  extractedText: string | null
  /** LLM-enriched text: description/transcription (for conversation injection) */
  llmText: string | null
  /** Category label for context injection (e.g. "[PDF/DOC]", "[Imagen]") */
  categoryLabel: string
  summary: string | null
  tokenEstimate: number
  sizeTier: AttachmentSizeTier
  cacheKey: string | null
  status: AttachmentStatus
  injectionRisk: boolean
  sourceType: AttachmentSourceType
  sourceRef: string | null
  /** Whether LLM enrichment was performed */
  llmEnriched: boolean
}

/** URL extraction result */
export interface UrlExtraction {
  url: string
  title: string | null
  extractedText: string | null
  tokenEstimate: number
  status: AttachmentStatus
  injectionRisk: boolean
  cacheKey: string | null
}

/** Complete attachment context injected into ContextBundle */
export interface AttachmentContext {
  attachments: ProcessedAttachment[]
  urls: UrlExtraction[]
  totalTokens: number
  fallbackMessages: string[]
}

/** Injection validation result */
export interface InjectionValidationResult {
  safe: boolean
  injectionRisk: boolean
  threats: string[]
  sanitizedText: string
}

/** Attachment engine config (read from env) */
export interface AttachmentEngineConfig {
  enabled: boolean
  smallDocTokens: number
  mediumDocTokens: number
  summaryMaxTokens: number
  cacheTtlMs: number
  urlFetchTimeoutMs: number
  urlMaxSizeMb: number
  urlEnabled: boolean
}

/**
 * System-wide hard limits — protects the pipeline from overload.
 * These CANNOT be overridden by channel config (channel limits must be ≤ these).
 */
export const SYSTEM_HARD_LIMITS = {
  /** Absolute max file size in MB — no file beyond this will be processed */
  maxFileSizeMb: 50,
  /** Absolute max attachments per message — excess will be skipped with fallback */
  maxAttachmentsPerMessage: 15,
} as const

/**
 * Per-channel platform capabilities — what each channel can physically receive.
 * Channel config should only enable categories that the platform supports.
 * Categories NOT in this list for a channel will be silently ignored even if enabled in config.
 */
export const CHANNEL_SUPPORTED_CATEGORIES: Record<string, AttachmentCategory[]> = {
  whatsapp: ['images', 'documents', 'audio', 'spreadsheets', 'text'],
  email: ['documents', 'spreadsheets', 'images', 'presentations', 'text', 'audio'],
  'google-chat': ['images', 'documents'],
  voice: [],
}

/** Predefined fallback messages (not LLM-generated) */
export const FALLBACK_MESSAGES = {
  disabled_by_channel: 'Disculpa, no puedo ver {fileType} por este canal. Podrias enviarmelo como texto?',
  too_large: 'El archivo {filename} es demasiado grande ({sizeMb} MB). El limite es {maxMb} MB.',
  extraction_failed: 'No pude leer {filename}. Podrias enviarlo en otro formato?',
  unsupported_type: 'No reconozco el formato de {filename}. Los formatos soportados son: PDF, Word, Excel, imagenes y texto.',
  too_many_attachments: 'Recibí {count} archivos pero solo puedo procesar {max} a la vez. Los primeros {max} fueron procesados, los demas fueron omitidos.',
  system_limit_exceeded: 'El archivo {filename} excede el limite del sistema ({maxMb} MB). No puede ser procesado.',
} as const

/** MIME type to category mapping */
export const MIME_TO_CATEGORY: Record<string, AttachmentCategory> = {
  // Documents
  'application/pdf': 'documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'documents',
  'application/msword': 'documents',
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheets',
  'application/vnd.ms-excel': 'spreadsheets',
  'text/csv': 'spreadsheets',
  // Images
  'image/png': 'images',
  'image/jpeg': 'images',
  'image/webp': 'images',
  'image/gif': 'images',
  // Audio
  'audio/ogg': 'audio',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/wav': 'audio',
  'audio/webm': 'audio',
  'audio/opus': 'audio',
  'audio/ogg; codecs=opus': 'audio',
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentations',
  'application/vnd.ms-powerpoint': 'presentations',
  // Text
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/json': 'text',
} as const

/** Human-readable category names for fallback messages */
export const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  documents: 'documentos',
  spreadsheets: 'hojas de calculo',
  images: 'imagenes',
  audio: 'audio',
  presentations: 'presentaciones',
  text: 'archivos de texto',
  web_link: 'enlaces web',
}
