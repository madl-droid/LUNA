// LUNA Engine — Message Normalizer
// Sanitiza unicode, trunca, detecta tipo de contenido.

import type { MessageContentType } from '../../channels/types.js'

const MAX_TEXT_LENGTH = 5000

// Regex to strip invisible/control chars except newlines and tabs
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u00AD\u2060\u2061-\u2064\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// Normalize fancy unicode quotes, dashes, etc.
const UNICODE_REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],   // smart single quotes
  [/[\u201C\u201D\u201E\u201F]/g, '"'],   // smart double quotes
  [/[\u2013\u2014]/g, '-'],               // en/em dashes
  [/\u2026/g, '...'],                      // ellipsis
  [/[\u00A0]/g, ' '],                      // non-breaking space
]

/**
 * Normalize and sanitize message text.
 * - Strips invisible characters
 * - Normalizes unicode quotes/dashes
 * - Trims whitespace
 * - Truncates to MAX_TEXT_LENGTH
 */
export function normalizeText(text: string | undefined | null): string {
  if (!text) return ''

  let result = text

  // Strip invisible chars
  result = result.replace(INVISIBLE_CHARS, '')

  // Normalize unicode
  for (const [pattern, replacement] of UNICODE_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }

  // Collapse multiple newlines into max 2
  result = result.replace(/\n{3,}/g, '\n\n')

  // Collapse multiple spaces into one
  result = result.replace(/ {2,}/g, ' ')

  // Trim
  result = result.trim()

  // Truncate
  if (result.length > MAX_TEXT_LENGTH) {
    result = result.substring(0, MAX_TEXT_LENGTH)
  }

  return result
}

/**
 * Detect message content type from the raw content object.
 */
export function detectMessageType(content: { type: string; text?: string }): MessageContentType {
  if (content.type === 'text' && content.text) return 'text'
  const valid = new Set<string>(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact'])
  return (valid.has(content.type) ? content.type : 'text') as MessageContentType
}
