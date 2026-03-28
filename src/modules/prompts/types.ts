// LUNA — Module: prompts — Types

export type PromptSlot = 'identity' | 'job' | 'guardrails' | 'relationship' | 'evaluator' | 'criticizer'

export interface PromptRecord {
  id: string
  slot: PromptSlot
  variant: string        // 'default', 'lead', 'admin', etc.
  content: string
  isGenerated: boolean
  updatedAt: Date
}

export interface CompositorPrompts {
  identity: string
  job: string
  guardrails: string
  relationship: string   // resolved for the specific userType
  criticizer: string     // editable part of the quality checklist
}

export interface PromptsService {
  getPrompt(slot: PromptSlot, variant?: string): Promise<string>
  getCompositorPrompts(userType: string): Promise<CompositorPrompts>
  getEvaluatorGenerated(): Promise<string>
  generateEvaluator(): Promise<string>
  upsert(slot: PromptSlot, variant: string, content: string): Promise<void>
  listAll(): Promise<PromptRecord[]>
  invalidateCache(): void
  /** Agent first name. Single source of truth for all channels. Default: 'Luna'. */
  getAgentName(): string
  /** Agent last name. Default: '' (empty). */
  getAgentLastName(): string
  /** Agent full name (first + last, trimmed). Used for signatures, greetings, etc. */
  getAgentFullName(): string
  /** Agent language code (e.g. 'es', 'en'). Default: 'es'. */
  getLanguage(): string
  /** Agent accent / locale (BCP-47, e.g. 'es-MX', 'en-US'). Default: 'es-MX'. */
  getAccent(): string
  /** Load a system prompt template (Category 2) and render with variables. */
  getSystemPrompt(name: string, variables?: Record<string, string>): Promise<string>
  /** Clear file-based template cache (for hot-reload). */
  clearSystemPromptCache(): void
  /** List available system prompt template names. */
  listSystemPrompts(): Promise<string[]>
}
