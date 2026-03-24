// LUNA — Shared Typing Delay Calculator
// Configurable per-channel typing delay for simulating human typing between bubbles.

/**
 * Calculate typing delay for a message part.
 * Each channel can configure its own msPerChar, min, and max values.
 *
 * @param text     - The message text
 * @param msPerChar - Milliseconds per character (default 50)
 * @param minMs    - Minimum delay in ms (default 500)
 * @param maxMs    - Maximum delay in ms (default 3000)
 */
export function calculateTypingDelay(
  text: string,
  msPerChar = 50,
  minMs = 500,
  maxMs = 3000,
): number {
  return Math.min(maxMs, Math.max(minMs, text.length * msPerChar))
}
