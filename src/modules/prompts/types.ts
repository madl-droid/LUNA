// LUNA — Module: prompts — Types

export type PromptSlot = 'identity' | 'job' | 'guardrails' | 'relationship' | 'evaluator' | 'criticizer'

/** A behavioral skill/protocol that the agent can apply to specific interaction patterns */
export interface SkillDefinition {
  /** Unique skill identifier (matches the .md filename without extension) */
  name: string
  /** Short description shown in the catalog stub within the system prompt */
  description: string
  /** Absolute path to the full .md instructions file */
  file: string
  /** User types that can trigger this skill. Empty array = available to all user types */
  userTypes: string[]
  /** Optional regex patterns that suggest this skill might be relevant */
  triggerPatterns?: string[]
}

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
  /** List available skills from instance/prompts/system/skills/ */
  listSkills(userType?: string): Promise<SkillDefinition[]>
}
