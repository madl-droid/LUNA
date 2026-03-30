// LUNA — Module: subagents — Types

/** Row from subagent_types table */
export interface SubagentTypeRow {
  id: string
  slug: string
  name: string
  description: string
  enabled: boolean
  modelTier: 'normal' | 'complex'
  tokenBudget: number
  verifyResult: boolean
  canSpawnChildren: boolean
  allowedTools: string[]
  allowedKnowledgeCategories: string[]
  systemPrompt: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Input for creating a new subagent type */
export interface CreateSubagentType {
  slug: string
  name: string
  description?: string
  enabled?: boolean
  modelTier?: 'normal' | 'complex'
  tokenBudget?: number
  verifyResult?: boolean
  canSpawnChildren?: boolean
  allowedTools?: string[]
  allowedKnowledgeCategories?: string[]
  systemPrompt?: string
}

/** Input for updating a subagent type */
export interface UpdateSubagentType {
  name?: string
  description?: string
  enabled?: boolean
  modelTier?: 'normal' | 'complex'
  tokenBudget?: number
  verifyResult?: boolean
  canSpawnChildren?: boolean
  allowedTools?: string[]
  allowedKnowledgeCategories?: string[]
  systemPrompt?: string
  sortOrder?: number
}

/** Row from subagent_usage table */
export interface SubagentUsageRow {
  id: string
  subagentTypeId: string | null
  subagentSlug: string
  traceId: string | null
  iterations: number
  tokensUsed: number
  durationMs: number
  success: boolean
  verified: boolean
  verificationVerdict: string | null
  childSpawned: boolean
  costUsd: number
  error: string | null
  createdAt: string
}

/** Aggregated usage stats for console display */
export interface SubagentUsageSummary {
  period: string
  totalExecutions: number
  totalTokens: number
  totalCostUsd: number
  totalErrors: number
  avgIterations: number
  avgDurationMs: number
  bySubagent: Record<string, {
    name: string
    executions: number
    tokens: number
    costUsd: number
    errors: number
    avgIterations: number
    avgDurationMs: number
    successRate: number
  }>
}

/** Catalog entry exposed to the engine via subagents:catalog service */
export interface SubagentCatalogEntry {
  id: string
  slug: string
  name: string
  description: string
  modelTier: 'normal' | 'complex'
  tokenBudget: number
  verifyResult: boolean
  canSpawnChildren: boolean
  allowedTools: string[]
  allowedKnowledgeCategories: string[]
  systemPrompt: string
}

/** Input for recording a subagent execution */
export interface RecordSubagentUsage {
  subagentTypeId: string | null
  subagentSlug: string
  traceId?: string
  iterations: number
  tokensUsed: number
  durationMs: number
  success: boolean
  verified?: boolean
  verificationVerdict?: string
  childSpawned?: boolean
  costUsd: number
  error?: string
}
