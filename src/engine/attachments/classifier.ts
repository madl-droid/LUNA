// LUNA Engine — Attachment Classifier (lightweight, Phase 1)
// Extracts metadata only — NO downloading, NO processing, NO LLM calls.
// Heavy processing moves to Phase 3 as 'process_attachment' steps.

import type { IncomingMessage } from '../../channels/types.js'
import type { AttachmentMetadata } from '../types.js'

/** MIME → category mapping */
const MIME_CATEGORIES: Record<string, AttachmentMetadata['type']> = {
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'text/plain': 'text',
  'text/csv': 'text',
  'text/html': 'text',
}

function categoryFromMime(mime: string | undefined | null): AttachmentMetadata['type'] {
  if (!mime) return 'unknown'
  if (MIME_CATEGORIES[mime]) return MIME_CATEGORIES[mime]!
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/')) return 'text'
  return 'unknown'
}

/**
 * Classify attachments from an incoming message.
 * Returns lightweight metadata — no I/O, no processing.
 * Target: <1ms.
 */
export function classifyAttachments(message: IncomingMessage): AttachmentMetadata[] {
  const attachments = message.attachments
  if (!attachments?.length) return []

  return attachments.map((att, index) => ({
    index,
    type: categoryFromMime(att.mimeType),
    name: att.filename ?? null,
    size: att.size ?? null,
    mime: att.mimeType ?? null,
  }))
}
