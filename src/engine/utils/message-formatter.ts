// LUNA Engine — Message Formatter
// Formateo por canal: burbujas WA ≤300 chars, HTML email, etc.

import type { ChannelName } from '../../channels/types.js'

const WA_MAX_CHARS = 300
const WA_MAX_BUBBLES = 3

/**
 * Format response text for a specific channel.
 * Returns array of message parts (e.g., multiple WA bubbles).
 */
export function formatForChannel(
  text: string,
  channel: ChannelName,
): string[] {
  switch (channel) {
    case 'whatsapp':
      return formatForWhatsApp(text)
    case 'email':
      return [formatForEmail(text)]
    default:
      return [text]
  }
}

/**
 * WhatsApp: split into ≤300 char bubbles, max 3 bubbles.
 * Splits on paragraph breaks, then sentence breaks if needed.
 */
function formatForWhatsApp(text: string): string[] {
  // If short enough, single bubble
  if (text.length <= WA_MAX_CHARS) return [text]

  const bubbles: string[] = []
  const paragraphs = text.split(/\n\n+/)

  let current = ''

  for (const para of paragraphs) {
    if (bubbles.length >= WA_MAX_BUBBLES - 1) {
      // Last bubble: dump remaining
      current = current ? `${current}\n\n${para}` : para
      continue
    }

    if (!current) {
      current = para
    } else if ((current + '\n\n' + para).length <= WA_MAX_CHARS) {
      current = `${current}\n\n${para}`
    } else {
      bubbles.push(current.substring(0, WA_MAX_CHARS))
      current = para
    }
  }

  if (current) {
    bubbles.push(current.substring(0, WA_MAX_CHARS))
  }

  return bubbles.slice(0, WA_MAX_BUBBLES)
}

/**
 * Email: wrap in basic HTML structure.
 */
function formatForEmail(text: string): string {
  // Convert markdown-like formatting to basic HTML
  let html = text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Paragraphs
    .replace(/\n\n+/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>')

  return `<p>${html}</p>`
}

/**
 * Calculate typing delay for WhatsApp (simulate human typing).
 * Returns milliseconds to wait before sending.
 */
export function calculateTypingDelay(text: string): number {
  // ~50ms per character, min 500ms, max 3000ms
  const delay = Math.min(3000, Math.max(500, text.length * 50))
  return delay
}
