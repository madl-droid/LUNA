// LUNA — Module: prompts — Types

export type PromptSlot = 'identity' | 'job' | 'guardrails' | 'relationship' | 'evaluator'

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
}

export interface CampaignRecord {
  id: string
  name: string
  matchPhrases: string[]
  matchThreshold: number
  promptContext: string
}

export interface CampaignMatchResult {
  campaignId: string
  name: string
  promptContext: string
}

export interface PromptsService {
  getPrompt(slot: PromptSlot, variant?: string): Promise<string>
  getCompositorPrompts(userType: string): Promise<CompositorPrompts>
  getEvaluatorGenerated(): Promise<string>
  generateEvaluator(): Promise<string>
  upsert(slot: PromptSlot, variant: string, content: string): Promise<void>
  listAll(): Promise<PromptRecord[]>
  matchCampaign(text: string): CampaignMatchResult | null
  invalidateCache(): void
  /** Agent name for @mention detection in groups/rooms. Single source of truth for all instant channels. */
  getAgentName(): string
}
