// LUNA Engine — Message Formatter
// Formateo por canal: burbujas WA por párrafo, HTML email, etc.

import type { ChannelName } from '../../channels/types.js'
import type { Registry } from '../../kernel/registry.js'

/**
 * Format response text for a specific channel.
 * Returns array of message parts (e.g., multiple WA bubbles).
 * Registry param reserved for future per-channel config from console.
 */
export function formatForChannel(
  text: string,
  channel: ChannelName,
  _registry?: Registry,
): string[] {
  switch (channel) {
    case 'whatsapp':
    case 'google-chat':
      return formatForInstant(text)
    case 'email':
      return [formatForEmail(text)]
    default:
      return [text]
  }
}

/**
 * Instant channels (WhatsApp, Google Chat): split on paragraph breaks.
 * The LLM composes with \n\n as bubble separators — we just split there.
 * Each paragraph becomes one message bubble.
 */
function formatForInstant(text: string): string[] {
  const parts = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0)
  return parts.length > 0 ? parts : [text]
}

/**
 * Email: wrap in basic HTML structure.
 * Escapes HTML entities first, then applies markdown-like formatting.
 */
function formatForEmail(text: string): string {
  // Escape HTML entities to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // Apply markdown-like formatting on escaped text
  html = html
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

// Typing delay moved to src/channels/typing-delay.ts (shared, configurable per-channel)
