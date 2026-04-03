// LUNA — Memory system types (v3)
// Covers hot (messages), warm (session_summaries), cold (contact_memory) tiers.

// ═══════════════════════════════════════════
// Legacy compat — kept for existing consumers
// ═══════════════════════════════════════════

export type SenderType = 'user' | 'agent'
export type MessageRole = 'user' | 'assistant' | 'system'
export type ContentType = 'text' | 'image' | 'audio' | 'document' | 'location' | 'sticker' | 'video'

export interface StoredMessage {
  id: string
  sessionId: string
  // Legacy fields (dual-write period)
  channelName: string
  senderType: SenderType
  senderId: string
  content: MessageContent
  // New v3 fields
  role: MessageRole
  contentText: string
  contentType: ContentType
  mediaPath?: string | null
  mediaMime?: string | null
  mediaAnalysis?: string | null
  intent?: string | null
  emotion?: string | null
  tokensUsed?: number | null
  latencyMs?: number | null
  modelUsed?: string | null
  tokenCount?: number | null
  metadata?: Record<string, unknown>
  createdAt: Date
}

export interface MessageContent {
  type: string
  text?: string
  mediaUrl?: string
  summary?: string
}

// ═══════════════════════════════════════════
// Session metadata
// ═══════════════════════════════════════════

export interface SessionMeta {
  sessionId: string
  contactId: string
  channelName: string
  startedAt: Date
  lastActivityAt: Date
  messageCount: number
  compressed: boolean
  status: 'active' | 'closed' | 'compressed'
}

// ═══════════════════════════════════════════
// Session summaries — Warm tier
// ═══════════════════════════════════════════

export interface SessionSummary {
  id: string
  sessionId: string
  contactId: string
  channelIdentifier?: string | null
  summaryText: string
  summaryLanguage: string
  keyFacts: KeyFact[]
  structuredData: Record<string, unknown>
  originalMessageCount: number
  modelUsed: string
  compressionTokens?: number | null
  interactionStartedAt: Date
  interactionClosedAt: Date
  mergedToMemoryAt?: Date | null
  createdAt: Date
}

export interface KeyFact {
  fact: string
  source: string
  confidence: number
  supersedes?: string
}

// ═══════════════════════════════════════════
// Summary chunks — Semantic search tier (individual embeddings per chunk)
// ═══════════════════════════════════════════

export interface SummaryChunk {
  id: string
  summaryId: string
  contactId: string
  chunkText: string
  chunkIndex: number
  embedding?: number[] | null
  createdAt: Date
}

// ═══════════════════════════════════════════
// Contact memory — Cold tier (stored in agent_contacts.contact_memory JSONB)
// ═══════════════════════════════════════════

export interface ContactMemory {
  summary: string
  key_facts: KeyFact[]
  preferences: Record<string, unknown>
  important_dates: ImportantDate[]
  relationship_notes: string
}

export interface ImportantDate {
  date: string
  what: string
}

// ═══════════════════════════════════════════
// Agent-Contact relationship
// ═══════════════════════════════════════════

export type LeadStatus =
  | 'unknown' | 'new' | 'qualifying' | 'qualified' | 'scheduled'
  | 'attended' | 'converted' | 'out_of_zone' | 'not_interested' | 'cold' | 'blocked'

export interface AgentContact {
  id: string
  contactId: string
  leadStatus: LeadStatus
  qualificationData: Record<string, unknown>
  qualificationScore: number
  agentData: Record<string, unknown>
  assignedTo?: string | null
  assignedAt?: Date | null
  followUpCount: number
  lastFollowUpAt?: Date | null
  nextFollowUpAt?: Date | null
  sourceCampaign?: string | null
  sourceChannel?: string | null
  contactMemory: ContactMemory
  createdAt: Date
  updatedAt: Date
}

// ═══════════════════════════════════════════
// Commitments
// ═══════════════════════════════════════════

export type CommitmentStatus = 'pending' | 'in_progress' | 'waiting' | 'done' | 'overdue' | 'no_show' | 'cancelled' | 'failed'
export type CommitmentType = 'action' | 'meeting' | 'demo' | 'call' | 'appointment' | 'follow_up' | 'send_material' | 'wait_response' | string
export type CommitmentPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Commitment {
  id: string
  contactId: string
  sessionId?: string | null
  commitmentBy: 'agent' | 'contact'
  description: string
  category?: string | null
  priority: CommitmentPriority
  commitmentType: CommitmentType
  dueAt?: Date | null
  scheduledAt?: Date | null
  eventStartsAt?: Date | null
  eventEndsAt?: Date | null
  externalId?: string | null
  externalProvider?: string | null
  assignedTo?: string | null
  status: CommitmentStatus
  attemptCount: number
  lastAttemptAt?: Date | null
  nextCheckAt?: Date | null
  blockedReason?: string | null
  waitType?: string | null
  actionTaken?: string | null
  parentId?: string | null
  sortOrder: number
  watchMetadata?: Record<string, unknown> | null
  reminderSent: boolean
  requiresTool?: string | null
  autoCancelAt?: Date | null
  createdVia?: 'tool' | 'auto_detect' | null
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  completedAt?: Date | null
}

// ═══════════════════════════════════════════
// Conversation archives — Legal backup
// ═══════════════════════════════════════════

export interface ConversationArchive {
  id: string
  sessionId: string
  contactId: string
  channelIdentifier?: string | null
  channelType?: string | null
  contactSnapshot: Record<string, unknown>
  messages: unknown[]
  messageCount: number
  interactionStartedAt: Date
  interactionClosedAt: Date
  archivedAt: Date
}

// ═══════════════════════════════════════════
// Fact correction (returned by evaluator/phase5)
// ═══════════════════════════════════════════

export interface FactCorrection {
  oldFact: string
  newFact: string
  source: string
  confidence: number
}

// ═══════════════════════════════════════════
// Hybrid search result
// ═══════════════════════════════════════════

export interface HybridSearchResult {
  summaryId: string
  sessionId: string
  summaryText: string
  keyFacts: KeyFact[]
  score: number
  matchType: 'fts' | 'vector' | 'recency' | 'chunk_vector'
  interactionStartedAt: Date
}

// ═══════════════════════════════════════════
// Session archives — Legal backup (v2)
// ═══════════════════════════════════════════

export interface SessionArchive {
  id: string
  sessionId: string
  contactId: string
  channel: string
  startedAt: Date
  closedAt: Date
  messageCount: number
  messagesJson: StoredMessage[]
  attachmentsMeta: AttachmentArchiveMeta[] | null
}

export interface AttachmentArchiveMeta {
  filename: string
  category: string
  mimeType: string
  filePath: string | null
  extractionId: string
}

// ═══════════════════════════════════════════
// Session summaries v2 — LLM-generated
// ═══════════════════════════════════════════

export interface SessionSummaryV2 {
  id: string
  sessionId: string
  contactId: string
  title: string
  description: string
  fullSummary: string
  modelUsed: string | null
  tokensUsed: number | null
}

// ═══════════════════════════════════════════
// Session memory chunks — Long-term multimodal memory
// ═══════════════════════════════════════════

export interface SessionMemoryChunk {
  id: string
  sessionId: string
  contactId: string
  sourceId: string
  sourceType: string
  contentType: string
  chunkIndex: number
  chunkTotal: number
  prevChunkId: string | null
  nextChunkId: string | null
  content: string | null
  mediaRef: string | null
  mimeType: string | null
  extraMetadata: Record<string, unknown> | null
  hasEmbedding: boolean
  embedding: number[] | null
}

// ═══════════════════════════════════════════
// Compression status tracking
// ═══════════════════════════════════════════

export type CompressionStatus = 'queued' | 'archiving' | 'summarizing' | 'embedding' | 'cleaning' | 'done' | 'failed'

// ═══════════════════════════════════════════
// Compression result
// ═══════════════════════════════════════════

export interface CompressionResult {
  summary: string
  keyFacts: KeyFact[]
  structuredData: Record<string, unknown>
  originalCount: number
  keptRecentCount: number
  modelUsed: string
  tokensUsed: number
}

// ═══════════════════════════════════════════
// Pipeline log entry
// ═══════════════════════════════════════════

export interface PipelineLogEntry {
  messageId?: string | null
  contactId?: string | null
  sessionId?: string | null
  phase1Ms?: number | null
  phase2Ms?: number | null
  phase2Result?: Record<string, unknown> | null
  phase3Ms?: number | null
  phase3Result?: Record<string, unknown> | null
  phase4Ms?: number | null
  phase5Ms?: number | null
  totalMs?: number | null
  tokensInput?: number | null
  tokensOutput?: number | null
  estimatedCost?: number | null
  modelsUsed?: string[] | null
  toolsCalled?: string[] | null
  hadSubagent?: boolean
  hadFallback?: boolean
  error?: string | null
  replanAttempts?: number | null
  subagentIterations?: number | null
}
