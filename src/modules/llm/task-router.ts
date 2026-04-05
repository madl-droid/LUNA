// LUNA — LLM Task Router
// Source of truth for model/provider/key selection.
// Does NOT execute calls — each service queries the router and executes independently.
// See docs/architecture/task-routing.md for the full design.

import pino from 'pino'
import type { CircuitBreakerManager } from './circuit-breaker.js'
import type {
  LLMProviderName,
  LLMTask,
  TaskRoute,
  ProviderAdapter,
  LLMModuleConfig,
} from './types.js'

const logger = pino({ name: 'llm:router' })

// ═══════════════════════════════════════════
// Task temperature defaults (internal — not user-configurable)
// ═══════════════════════════════════════════

const TASK_TEMPERATURES: Partial<Record<LLMTask, number>> = {
  main: 0.7,
  complex: 0.5,
  low: 0.8,
  criticize: 0.3,
  media: 0.2,
  web_search: 0.3,
  compress: 0.2,
  batch: 0.3,
  tts: 0.8,
  // knowledge: embeddings — no temperature applicable
}

const TASK_MAX_TOKENS: Partial<Record<LLMTask, number>> = {
  low: 150,
}

// ═══════════════════════════════════════════
// Canonical tasks — the 10 routing targets
// ═══════════════════════════════════════════

/** All tasks that can be configured via LLM_{TASK}_PROVIDER/MODEL in the console */
const CONFIGURABLE_TASKS: LLMTask[] = [
  'main', 'complex', 'low', 'criticize', 'media',
  'web_search', 'compress', 'batch', 'tts', 'knowledge',
]

// ═══════════════════════════════════════════
// Task aliases — maps ALL custom names to canonical tasks
// ═══════════════════════════════════════════

/**
 * EVERY custom task name used anywhere in the codebase MUST be listed here.
 * This ensures all LLM calls route through the configured models, with proper
 * fallback chains, even when callers use descriptive task names.
 *
 * To add a new LLM call site:
 *   1. Pick a TaskCategory (from types.ts) — it maps directly to a canonical task
 *   2. If you use a descriptive task name instead, add it here
 *   3. Run `npx tsc --noEmit` to verify
 *
 * Canonical tasks (main, complex, low, criticize, media, web_search, compress,
 * batch, tts, knowledge) do NOT need aliases — they route directly.
 */
const TASK_ALIASES: Record<string, LLMTask> = {
  // ── Legacy canonical names (removed in v2, aliased for backward compatibility) ──
  'classify': 'main',
  'respond': 'main',
  'tools': 'main',
  'proactive': 'main',
  'vision': 'media',
  'stt': 'media',
  'document_read': 'media',
  'image_gen': 'media',
  'ack': 'low',

  // ── Engine: agentic loop ──
  'agentic': 'main',                    // agentic-loop.ts — main LLM loop

  // ── Engine: post-processor (criticizer) ──
  'criticizer-review': 'criticize',      // post-processor.ts — quality review step
  'criticizer-rewrite': 'criticize',     // post-processor.ts — quality rewrite step

  // ── Engine: ACK ──
  // 'ack' already aliased above to 'low'

  // ── Engine: buffer compression ──
  'buffer_compress': 'compress',         // buffer-compressor.ts

  // ── Engine: commitment detection ──
  'commitment-detect': 'main',           // commitment-detector.ts
  'detect_commitment': 'main',           // legacy alias

  // ── Engine: subagent ──
  'subagent': 'main',                    // subagent execution
  'subagent-verify': 'criticize',        // subagent verification step

  // ── Engine: proactive ──
  'nightly-scoring': 'batch',            // nightly-batch.ts
  'nightly-compress': 'batch',           // nightly-batch.ts
  'nightly-reactivation': 'batch',       // nightly-batch.ts
  'scheduled-task': 'main',              // scheduled-tasks/executor.ts

  // ── Extractors (all → media) ──
  'extractor-image-vision': 'media',     // extractors/image.ts
  'extractor-pdf-ocr': 'media',          // extractors/pdf.ts
  'extractor-pdf-vision': 'media',       // extractors/pdf.ts
  'extractor-slide-vision': 'media',     // extractors/slides.ts
  'extractor-thumbnail-vision': 'media', // extractors/youtube.ts
  'extractor-video-multimodal': 'media', // extractors/video.ts
  'extractor-summarize-large': 'media',  // attachments/processor.ts
  'transcribe': 'media',                 // legacy alias for STT
  'process_attachment': 'media',         // legacy alias
  'extract_knowledge': 'media',          // legacy alias
  'read_document': 'media',              // legacy alias
  'summarize_document': 'media',         // legacy alias

  // ── Modules: lead-scoring ──
  'extract_qualification': 'main',       // lead-scoring/extract-tool.ts

  // ── Modules: gmail ──
  'signature_extraction': 'main',        // gmail/signature-parser.ts
  'parse_signature': 'main',             // legacy alias

  // ── Modules: prompts ──
  'generate-evaluator': 'complex',       // prompts/prompts-service.ts

  // ── Modules: hitl ──
  'hitl-expire-message': 'main',         // hitl/notifier.ts
  'hitl-rephrase': 'main',               // hitl/resolver.ts

  // ── Modules: knowledge ──
  'knowledge-description': 'main',       // knowledge/description-generator.ts

  // ── Modules: medilink ──
  'medilink-followup-personalize': 'main', // medilink/follow-up-scheduler.ts

  // ── Modules: memory ──
  'session-summary-v2': 'compress',      // memory/session-archiver.ts

  // ── Modules: twilio-voice ──
  'summarize': 'main',                   // twilio-voice/voice-engine.ts

  // ── Modules: cortex (all → complex) ──
  'cortex-analyze': 'complex',           // cortex analysis
  'cortex-pulse': 'complex',             // cortex pulse
  'cortex-trace': 'complex',             // cortex trace
  'trace-evaluate': 'complex',           // cortex trace simulation
  'trace-compose': 'complex',            // cortex trace composition
  'trace-analyze': 'complex',            // cortex trace analysis
  'trace-synthesize': 'complex',         // cortex trace synthesis
  'trace-agentic': 'complex',            // cortex trace agentic sim

  // ── Legacy aliases (backward compatibility) ──
  'evaluate': 'main',                    // old Phase 2 name
  'proactive-evaluate': 'main',          // old proactive Phase 2
  'compose': 'main',                     // old Phase 4 name
}

// ═══════════════════════════════════════════
// Route resolution
// ═══════════════════════════════════════════

export type FallbackLevel = 'primary' | 'downgrade' | 'cross-api'

export interface ResolvedRoute {
  provider: LLMProviderName
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
  isFallback: boolean
  fallbackIndex: number
  /** Which level in the 3-tier fallback chain */
  fallbackLevel: FallbackLevel
}

/**
 * Resolve a task name to its canonical LLMTask.
 * Returns the canonical task if already canonical, or the alias target.
 * Falls back to 'main' for unknown task names (logged as warning).
 */
export function resolveTaskName(task: string): LLMTask {
  if (CONFIGURABLE_TASKS.includes(task as LLMTask)) return task as LLMTask
  const aliased = TASK_ALIASES[task]
  if (aliased) return aliased
  logger.warn({ task }, 'Unknown task name — routing to "main". Add it to TASK_ALIASES in task-router.ts')
  return 'main'
}

export class TaskRouter {
  private routes: Map<LLMTask, TaskRoute> = new Map()
  private fallbackChain: LLMProviderName[] = ['anthropic', 'google']

  constructor(
    private readonly adapters: Map<LLMProviderName, ProviderAdapter>,
    private readonly breakers: CircuitBreakerManager,
    private readonly apiKeys: Map<string, string>, // envVar → key
  ) {}

  /**
   * Build all routes from module config. No hardcoded defaults —
   * all defaults come from configSchema Zod `.default()` values.
   */
  loadFromConfig(config: LLMModuleConfig): void {
    // Parse fallback chain
    if (config.LLM_FALLBACK_CHAIN) {
      try {
        this.fallbackChain = config.LLM_FALLBACK_CHAIN.split(',').map(s => s.trim()) as LLMProviderName[]
      } catch { /* keep default */ }
    }

    const cfg = config as unknown as Record<string, string | undefined>

    // Build routes from per-task config fields
    for (const task of CONFIGURABLE_TASKS) {
      const upper = task.toUpperCase()
      const provider = cfg[`LLM_${upper}_PROVIDER`] as LLMProviderName | undefined
      const model = cfg[`LLM_${upper}_MODEL`]
      if (!provider || !model) continue

      const temperature = TASK_TEMPERATURES[task]
      const maxTokens = TASK_MAX_TOKENS[task]

      // Downgrade (optional)
      const dgProvider = cfg[`LLM_${upper}_DOWNGRADE_PROVIDER`] as LLMProviderName | undefined
      const dgModel = cfg[`LLM_${upper}_DOWNGRADE_MODEL`]
      const downgrade = dgProvider && dgModel
        ? { provider: dgProvider, model: dgModel, temperature }
        : undefined

      // Cross-API fallback (optional)
      const fbProvider = cfg[`LLM_${upper}_FALLBACK_PROVIDER`] as LLMProviderName | undefined
      const fbModel = cfg[`LLM_${upper}_FALLBACK_MODEL`]
      const fallbacks = fbProvider && fbModel
        ? [{ provider: fbProvider, model: fbModel, temperature, maxTokens }]
        : []

      const route: TaskRoute = {
        task,
        primary: { provider, model, temperature, maxTokens, downgrade },
        fallbacks,
      }

      const warning = this.validateRoute(task, route)
      if (warning) logger.warn({ task, provider }, warning)

      this.routes.set(task, route)
    }
  }

  /**
   * Update a specific task route (from console UI).
   * Returns a warning message if the route has a problem (e.g. web_search without Google).
   */
  setRoute(task: LLMTask, route: TaskRoute): { warning?: string } {
    const warning = this.validateRoute(task, route)
    this.routes.set(task, route)
    logger.info({ task, primary: route.primary.provider + '/' + route.primary.model, warning }, 'Route updated')
    return { warning }
  }

  /**
   * Get the configured route for a task.
   */
  getRoute(task: LLMTask): TaskRoute | undefined {
    return this.routes.get(task)
  }

  /**
   * Get all configured routes.
   */
  getAllRoutes(): TaskRoute[] {
    return [...this.routes.values()]
  }

  /**
   * Resolve the best available target for a request.
   * Considers: explicit overrides, circuit breaker state, adapter availability.
   * Returns ordered list of targets to try.
   *
   * @param task - Any task name (canonical or custom). Custom names are aliased automatically.
   */
  resolve(
    task: LLMTask | string,
    overrideProvider?: LLMProviderName,
    overrideModel?: string,
    overrideApiKeyEnv?: string,
  ): ResolvedRoute[] {
    const results: ResolvedRoute[] = []
    const resolvedTask = resolveTaskName(task)
    const route = this.routes.get(resolvedTask)

    // If explicit override, try that first
    if (overrideProvider && overrideModel) {
      const key = this.resolveApiKeyForTask(overrideProvider, overrideApiKeyEnv)
      if (key) {
        results.push({
          provider: overrideProvider,
          model: overrideModel,
          apiKey: key,
          isFallback: false,
          fallbackIndex: -1,
          fallbackLevel: 'primary',
        })
      }
    }

    if (route) {
      // Primary target
      const primaryKey = this.resolveApiKeyForTask(route.primary.provider, route.primary.apiKeyEnv)
      if (primaryKey && this.isAvailable(route.primary.provider)) {
        results.push({
          provider: route.primary.provider,
          model: route.primary.model,
          apiKey: primaryKey,
          temperature: route.primary.temperature,
          maxTokens: route.primary.maxTokens,
          isFallback: false,
          fallbackIndex: -1,
          fallbackLevel: 'primary',
        })
      }

      // Downgrade target (same provider, lesser model)
      if (route.primary.downgrade) {
        const dg = route.primary.downgrade
        const dgKey = this.resolveApiKeyForTask(dg.provider, dg.apiKeyEnv)
        if (dgKey && this.isAvailable(dg.provider)) {
          results.push({
            provider: dg.provider,
            model: dg.model,
            apiKey: dgKey,
            temperature: dg.temperature ?? route.primary.temperature,
            maxTokens: dg.maxTokens ?? route.primary.maxTokens,
            isFallback: true,
            fallbackIndex: -1,
            fallbackLevel: 'downgrade',
          })
        }
      }

      // Cross-API fallback targets
      for (let i = 0; i < route.fallbacks.length; i++) {
        const fb = route.fallbacks[i]!
        const fbKey = this.resolveApiKeyForTask(fb.provider, fb.apiKeyEnv)
        if (fbKey && this.isAvailable(fb.provider)) {
          results.push({
            provider: fb.provider,
            model: fb.model,
            apiKey: fbKey,
            temperature: fb.temperature,
            maxTokens: fb.maxTokens,
            isFallback: true,
            fallbackIndex: i,
            fallbackLevel: 'cross-api',
          })
        }
      }
    }

    // Last resort: try any available provider from fallback chain
    if (results.length === 0) {
      for (const provider of this.fallbackChain) {
        const key = this.resolveApiKeyForProvider(provider)
        if (key && this.isAvailable(provider)) {
          results.push({
            provider,
            model: this.defaultModelFor(provider),
            apiKey: key,
            isFallback: true,
            fallbackIndex: 99,
            fallbackLevel: 'cross-api',
          })
          break
        }
      }
    }

    // Deduplicate by provider+model
    const seen = new Set<string>()
    return results.filter(r => {
      const key = `${r.provider}:${r.model}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * Validate a route configuration and return a warning if problematic.
   * web_search MUST use Google as primary for native search grounding.
   * Anthropic does not have native web search — results will be degraded.
   */
  private validateRoute(task: LLMTask | string, route: TaskRoute): string | undefined {
    if (task === 'web_search' && route.primary.provider !== 'google') {
      return 'web_search debe usar Google como provider primario. Anthropic no tiene búsqueda web nativa — los resultados serán degradados o fallarán.'
    }
    return undefined
  }

  // ─── Private helpers ────────────────────────

  private isAvailable(provider: LLMProviderName): boolean {
    const adapter = this.adapters.get(provider)
    if (!adapter) return false
    return this.breakers.get(provider).isAvailable()
  }

  /**
   * Resolve API key for a provider. One key per provider — simple.
   */
  private resolveApiKeyForTask(provider: LLMProviderName, envVar?: string): string | null {
    if (envVar) {
      const key = this.apiKeys.get(envVar)
      if (key) return key
    }
    return this.resolveApiKeyForProvider(provider)
  }

  private resolveApiKeyForProvider(provider: LLMProviderName): string | null {
    const defaultVars: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
    }
    return this.apiKeys.get(defaultVars[provider]) ?? null
  }

  private defaultModelFor(provider: LLMProviderName): string {
    const defaults: Record<LLMProviderName, string> = {
      anthropic: 'claude-sonnet-4-6-20260214',
      google: 'gemini-2.5-flash',
    }
    return defaults[provider]
  }
}
