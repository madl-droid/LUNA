// LUNA — LLM Module Helpers

const FAMILIES = ['haiku', 'sonnet', 'opus', 'flash', 'pro'] as const

/**
 * Detect the model family from a model ID string.
 * Returns the first matching family keyword or 'unknown'.
 */
export function detectFamily(modelId: string): string {
  const lower = modelId.toLowerCase()
  for (const f of FAMILIES) {
    if (lower.includes(f)) return f
  }
  return 'unknown'
}
