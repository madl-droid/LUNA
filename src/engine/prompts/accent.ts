// LUNA Engine — Accent Section Builder
// Builds the dynamic <accent> section for the agentic system prompt.
// Reads accent config from PromptsService (which reads from registry config).
// The config_store override (AGENT_ACCENT_PROMPT) is already handled inside
// PromptsService.getCompositorPrompts() — we extract and expose it here.

import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'

/**
 * Build the <accent> section string for the system prompt.
 *
 * Returns an empty string if no accent is configured.
 * The accent prompt itself is read from the prompts module config
 * (AGENT_ACCENT and AGENT_ACCENT_PROMPT env vars / registry config).
 *
 * The PromptsService already assembles the accent into identity via
 * getCompositorPrompts(). This function extracts it as a standalone section
 * for use in the agentic builder where sections are XML-tagged.
 */
export async function buildAccentSection(
  registry: Registry,
): Promise<string> {
  const svc = registry.getOptional<PromptsService>('prompts:service')
  if (!svc) return ''

  const accent = svc.getAccent()
  if (!accent) return ''

  // Read AGENT_ACCENT_PROMPT from module config
  try {
    const cfg = registry.getConfig<{
      AGENT_ACCENT?: string
      AGENT_ACCENT_PROMPT?: string
    }>('prompts')

    const accentPrompt = cfg.AGENT_ACCENT_PROMPT?.trim() ?? ''
    if (!accentPrompt) return ''

    return `<accent>\n${accentPrompt}\n</accent>`
  } catch {
    return ''
  }
}
