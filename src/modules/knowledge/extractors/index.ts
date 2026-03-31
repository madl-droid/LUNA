// LUNA — Module: knowledge — Extractor Registry (SHIM)
// Re-exports from global src/extractors/.
// Mantiene backward compatibility para consumers internos de knowledge.

export {
  extractContent,
  resolveMimeType,
  isSupportedMimeType,
  getSupportedExtensions,
  GOOGLE_NATIVE_TYPES,
} from '../../../extractors/index.js'

export type {
  ExtractedContent,
  ExtractedSection,
  ExtractorFn,
  DocumentMetadata,
} from '../../../extractors/types.js'
