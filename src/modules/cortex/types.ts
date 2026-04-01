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
  // Pulse config
  CORTEX_PULSE_ENABLED: boolean
  CORTEX_PULSE_MODE: string
  CORTEX_PULSE_BATCH_TIME: string
  CORTEX_PULSE_DELIVERY_TIME: string
  CORTEX_PULSE_SYNC_INTERVAL_HOURS: number
  CORTEX_PULSE_IMMEDIATE_CRITICAL_COUNT: number
  CORTEX_PULSE_IMMEDIATE_FLAP_TIMEOUT_MS: number
  CORTEX_PULSE_LLM_DEFAULT_MODEL: string
  CORTEX_PULSE_LLM_ESCALATION_MODEL: string
  CORTEX_PULSE_LLM_ESCALATION_THRESHOLD: number
  CORTEX_PULSE_LOGS_MAX_UNIQUE: number
  // Trace config
  CORTEX_TRACE_ENABLED: boolean
  CORTEX_TRACE_MODEL: string
  CORTEX_TRACE_ANALYSIS_MODEL: string
  CORTEX_TRACE_MAX_CONCURRENT: number
  CORTEX_TRACE_MAX_TOKENS_PHASE2: number
  CORTEX_TRACE_MAX_TOKENS_PHASE4: number
  CORTEX_TRACE_MAX_TOKENS_ANALYSIS: number
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

// ═══════════════════════════════════════════
// Pulse — Health analysis
// ═══════════════════════════════════════════

export type PulseMode = 'batch' | 'sync'
export type PulseReportMode = 'batch' | 'sync' | 'immediate'
export type OverallHealthAssessment = 'healthy' | 'degraded' | 'critical'

export interface PulseIncident {
  what: string
  impact: string
  root_cause: string
  immediate_fix: string
  long_term_fix: string
}

export interface PulseMetricsSummary {
  messages_processed: number
  avg_latency_ms: number
  error_rate: string
  fallback_rate: string
  uptime_percent: string
}

export interface PulseReport {
  period: string
  period_start: string
  period_end: string
  overall_health: OverallHealthAssessment
  summary: string
  incidents: PulseIncident[]
  metrics_summary: PulseMetricsSummary
  recommendations: string[]
}

export interface PulseReportRow {
  id: string
  period_start: string
  period_end: string
  mode: PulseReportMode
  report_json: PulseReport
  model_used: string
  tokens_used: number
  created_at: string
}

/** Curated data package sent to LLM (~4-8K tokens) */
export interface PulseDataPackage {
  alerts: Array<{
    rule: string
    severity: string
    state: string
    message: string
    triggeredAt: number
    resolvedAt: number | null
    duration_seconds: number | null
    flapCount: number
  }>
  metrics: import('./reflex/metrics-store.js').MetricsSummary
  hourly_metrics: Array<{
    hour: string
    pipeline: number
    llm_errors: number
    llm_fallbacks: number
  }>
  logs: Array<{
    component: string
    level: string
    message: string
    count: number
    first_seen: string
    last_seen: string
  }>
  health_snapshot: Record<string, unknown> | null
  circuit_breakers: Record<string, string>
  period_start: string
  period_end: string
}

export interface PulseConfig {
  CORTEX_PULSE_ENABLED: boolean
  CORTEX_PULSE_MODE: string
  CORTEX_PULSE_BATCH_TIME: string
  CORTEX_PULSE_DELIVERY_TIME: string
  CORTEX_PULSE_SYNC_INTERVAL_HOURS: number
  CORTEX_PULSE_IMMEDIATE_CRITICAL_COUNT: number
  CORTEX_PULSE_IMMEDIATE_FLAP_TIMEOUT_MS: number
  CORTEX_PULSE_LLM_DEFAULT_MODEL: string
  CORTEX_PULSE_LLM_ESCALATION_MODEL: string
  CORTEX_PULSE_LLM_ESCALATION_THRESHOLD: number
  CORTEX_PULSE_LOGS_MAX_UNIQUE: number
}

// ═══════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════

export type DispatchChannel = 'whatsapp' | 'email' | 'telegram' | 'google-chat'

/** Maps dispatch channels to LUNA components they depend on.
 *  If the dependent component is down, don't use that channel. */
export const CHANNEL_DEPENDENCIES: Record<DispatchChannel, string[]> = {
  whatsapp: ['whatsapp'],
  email: ['gmail'],
  telegram: [],
  'google-chat': ['google-chat'],
}
