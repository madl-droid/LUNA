// cortex/types.ts — Domain types for Cortex module (Reflex feature)

// ═══════════════════════════════════════════
// Config
// ═══════════════════════════════════════════

export interface CortexConfig {
  CORTEX_REFLEX_ENABLED: boolean
  CORTEX_REFLEX_INFRA_INTERVAL_MS: number
  CORTEX_REFLEX_RESOURCE_INTERVAL_MS: number
  CORTEX_REFLEX_TRENDS_INTERVAL_MS: number
  CORTEX_REFLEX_FLUSH_INTERVAL_MS: number
  CORTEX_REFLEX_LOG_BUFFER_SIZE: number
  CORTEX_REFLEX_DEDUP_WINDOW_MS: number
  CORTEX_REFLEX_ESCALATION_MS: number
  CORTEX_REFLEX_CHANNELS: string
  CORTEX_TELEGRAM_BOT_TOKEN: string
  CORTEX_TELEGRAM_CHAT_ID: string
  CORTEX_REFLEX_SILENCE_START: string
  CORTEX_REFLEX_SILENCE_END: string
  CORTEX_REFLEX_MEM_THRESHOLD: number
  CORTEX_REFLEX_DISK_THRESHOLD: number
  CORTEX_REFLEX_LATENCY_THRESHOLD_MS: number
}

// ═══════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════

export type AlertSeverity = 'critical' | 'degraded' | 'info'

export type AlertState = 'triggered' | 'resolved' | 'escalated'

export interface Alert {
  rule: string
  severity: AlertSeverity
  state: AlertState
  message: string
  triggeredAt: number
  resolvedAt: number | null
  escalatedAt: number | null
  flapCount: number
  lastFlapAt: number | null
  /** Log lines from ring buffer at trigger time */
  logs: string[]
}

// ═══════════════════════════════════════════
// Rules
// ═══════════════════════════════════════════

export interface RuleCheckContext {
  db: import('pg').Pool
  redis: import('ioredis').Redis
  registry: import('../../kernel/registry.js').Registry
  counters: CounterSet
  config: CortexConfig
}

export interface Rule {
  id: string
  name: string
  severity: AlertSeverity
  /** Component tag for filtering ring buffer logs */
  component: string
  /** Returns true if the condition is met (something is wrong) */
  check: (ctx: RuleCheckContext) => Promise<boolean>
  /** Human-readable alert message */
  getMessage: (ctx: RuleCheckContext) => Promise<string>
}

// ═══════════════════════════════════════════
// Counters (in-memory, flushed to Redis)
// ═══════════════════════════════════════════

export interface CounterSet {
  pipeline_count: number
  pipeline_errors: number
  pipeline_latency_sum: number
  pipeline_latency_max: number
  llm_calls: number
  llm_errors: number
  llm_tokens_in: number
  llm_tokens_out: number
  llm_fallbacks: number
  tool_calls: number
  tool_errors: number
}

// ═══════════════════════════════════════════
// Ring buffer
// ═══════════════════════════════════════════

export interface RingBufferEntry {
  timestamp: number
  level: 'warn' | 'error'
  component: string
  message: string
}

// ═══════════════════════════════════════════
// Health
// ═══════════════════════════════════════════

export type ComponentStatus = 'connected' | 'disconnected' | 'not_configured'
export type EmailStatus = 'authenticated' | 'expired' | 'not_configured'
export type OverallStatus = 'healthy' | 'degraded' | 'down'

export interface HealthStatus {
  status: OverallStatus
  uptime_seconds: number
  components: {
    postgresql: ComponentStatus
    redis: ComponentStatus
    whatsapp: ComponentStatus
    email: EmailStatus
  }
  bullmq: {
    waiting: number
    active: number
    failed: number
  }
  pipeline: {
    messages_last_hour: number
    avg_latency_ms: number
  }
  circuit_breakers: Record<string, 'open' | 'closed' | 'half-open'>
}

// ═══════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════

export type DispatchChannel = 'whatsapp' | 'email' | 'telegram'

/** Maps dispatch channels to LUNA components they depend on.
 *  If the dependent component is down, don't use that channel. */
export const CHANNEL_DEPENDENCIES: Record<DispatchChannel, string[]> = {
  whatsapp: ['whatsapp'],
  email: ['gmail'],
  telegram: [],
}
