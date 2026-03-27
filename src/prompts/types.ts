// ── src/prompts/types.ts ── Types del sistema de prompts ──

export type PipelineStep =
  | 'classify'
  | 'respond'
  | 'respond_complex'
  | 'compress'
  | 'follow_up'

export interface PromptBlock {
  id: string
  content: string
  priority: number // menor = antes en el prompt ensamblado
}

export interface LeadContext {
  contactId: string
  name?: string
  phone?: string
  email?: string
  contactType: string       // 'unknown' | 'lead' | 'client_active' | etc
  qualificationStatus: string // 'unknown' | 'new' | 'qualifying' | etc
  qualificationData?: Record<string, unknown>
  previousSessions?: number
  tags?: string[]
  notes?: string
  channel: string
}

export interface BusinessContext {
  businessName: string
  businessType: string
  products: string[]
  serviceArea: string
  workingHours: string
  qualificationCriteria: QualificationCriterion[]
  customInstructions?: string
}

export interface QualificationCriterion {
  field: string
  question: string
  required: boolean
  validValues?: string[]
}

export interface ConversationContext {
  sessionId: string
  messages: ConversationMessage[]
  compressedSummary?: string
  messageCount: number
  sessionStartedAt: Date
  lastActivityAt: Date
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface ToolContext {
  executedTools: ToolExecutionResult[]
}

export interface ToolExecutionResult {
  toolName: string
  success: boolean
  result?: unknown
  error?: string
}

export interface ClassificationResult {
  intent: string
  subIntent?: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'angry'
  urgency: 'low' | 'medium' | 'high'
  toolsNeeded: string[]
  complexity: 'simple' | 'moderate' | 'complex'
  language: string
  isObjection: boolean
  objectionType?: string
}

export interface PromptContext {
  step: PipelineStep
  lead: LeadContext
  business: BusinessContext
  conversation: ConversationContext
  classification?: ClassificationResult
  tools?: ToolContext
  ttsEnabled: boolean
  currentDateTime: string
}

export interface AssembledPrompt {
  system: string
  messages: ConversationMessage[]
  userMessage?: string // solo para classify: el mensaje a clasificar
}
