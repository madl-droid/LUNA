// LUNA — Shared Typing Delay Calculator
// Configurable per-channel typing delay for simulating human typing between bubbles.
// Uses word count for natural pacing (~500ms per word feels human-like).

/**
 * Calculate typing delay for a message part based on word count.
 * More natural than per-character — reading/typing speed correlates better with words.
 *
 * @param text      - The message text to calculate delay for
 * @param minMs     - Minimum delay in ms (default 800)
 * @param maxMs     - Maximum delay in ms (default 4000)
 * @param msPerWord - Milliseconds per word (default 500)
 */
export function calculateTypingDelay(
  text: string,
  minMs = 800,
  maxMs = 4000,
  msPerWord = 500,
): number {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
  return Math.min(maxMs, Math.max(minMs, wordCount * msPerWord))
}
