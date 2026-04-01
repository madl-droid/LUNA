// cortex/trace/runner.ts — Orchestrator: manages N simulation runs with concurrency
// Uses a simple semaphore (no BullMQ). Launches async, returns immediately.

import type { Pool } from 'pg'
import type { Registry } from '../../../kernel/registry.js'
import type {
  ScenarioConfig, RunRequest, RunRow, RunSummary,
  TraceConfig, ResultRow, SandboxToolResult,
} from './types.js'
import { VALID_SIM_COUNTS } from './types.js'
import * as store from './store.js'
import { runSingleSimulation } from './simulator.js'
import { analyzeSimulation } from './analyst.js'
import { synthesizeResults } from './synthesizer.js'
import * as notifStore from '../notifications.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:runner' })

/** Active runs tracked in-memory for cancellation */
const activeRuns = new Map<string, { cancelled: boolean }>()

/**
 * Launch a simulation run. Returns immediately with the run ID.
 * Processing happens in the background.
 */
export async function launchRun(
  db: Pool,
  registry: Registry,
  request: RunRequest,
  traceConfig: TraceConfig,
): Promise<RunRow> {
  // Validate sim count
  if (!VALID_SIM_COUNTS.includes(request.simCount)) {
    throw new Error(`Invalid simCount: ${request.simCount}. Must be one of: ${VALID_SIM_COUNTS.join(', ')}`)
  }

  // Load scenario
  const scenario = await store.getScenario(db, request.scenarioId)
  if (!scenario) throw new Error(`Scenario not found: ${request.scenarioId}`)

  // Resolve variant overrides
  const variant = request.variantName && request.variantName !== 'baseline'
    ? scenario.config.variants?.find(v => v.name === request.variantName)
    : undefined

  // Create run in DB
  const run = await store.createRun(
    db,
    request.scenarioId,
    request.variantName ?? 'baseline',
    request.simCount,
    request.adminContext,
    {
      modelOverride: request.modelOverride,
      analysisModel: request.analysisModel,
    },
  )

  // Track for cancellation
  const runState = { cancelled: false }
  activeRuns.set(run.id, runState)

  // Launch async processing (non-blocking)
  processRun(db, registry, run, scenario.config, variant?.promptOverrides, traceConfig, request, runState)
    .catch(err => {
      logger.error({ err, runId: run.id }, 'Run processing failed fatally')
      store.updateRunStatus(db, run.id, 'failed', { error: err instanceof Error ? err.message : 'Fatal error' })
        .catch(() => {})
    })
    .finally(() => activeRuns.delete(run.id))

  return run
}

/**
 * Cancel a running run.
 */
export function cancelRun(runId: string): boolean {
  const state = activeRuns.get(runId)
  if (state) {
    state.cancelled = true
    return true
  }
  return false
}

/**
 * Check if any run is currently active.
 */
export function isRunActive(): boolean {
  return activeRuns.size > 0
}

// ═══════════════════════════════════════════
// Background processing
// ═══════════════════════════════════════════

async function processRun(
  db: Pool,
  registry: Registry,
  run: RunRow,
  scenario: ScenarioConfig,
  variantOverrides: import('./types.js').PromptOverrides | undefined,
  traceConfig: TraceConfig,
  request: RunRequest,
  runState: { cancelled: boolean },
): Promise<void> {
  const startMs = Date.now()

  // Mark as running
  await store.updateRunStatus(db, run.id, 'running', {
    progress: { completed: 0, total: run.sim_count, analyzing: 0 },
  })

  const maxConcurrent = traceConfig.CORTEX_TRACE_MAX_CONCURRENT
  const simCount = run.sim_count
  let completed = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  const allResults: ResultRow[][] = []

  // Simple semaphore for concurrency control
  let active = 0
  const queue: Array<() => void> = []

  function acquireSlot(): Promise<void> {
    if (active < maxConcurrent) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => queue.push(resolve))
  }

  function releaseSlot(): void {
    active--
    const next = queue.shift()
    if (next) {
      active++
      next()
    }
  }

  // Launch all simulations
  const tasks: Promise<void>[] = []

  for (let simIdx = 0; simIdx < simCount; simIdx++) {
    const task = (async (idx: number) => {
      if (runState.cancelled) return

      await acquireSlot()
      if (runState.cancelled) { releaseSlot(); return }

      try {
        const simResult = await runSingleSimulation(db, registry, scenario, variantOverrides, {
          runId: run.id,
          simIndex: idx,
          modelOverride: request.modelOverride,
          traceConfig,
        })

        allResults[idx] = simResult.results
        totalTokensIn += simResult.totalTokensInput
        totalTokensOut += simResult.totalTokensOutput

        completed++
        await store.updateRunStatus(db, run.id, 'running', {
          progress: { completed, total: simCount, analyzing: 0 },
        })
      } finally {
        releaseSlot()
      }
    })(simIdx)

    tasks.push(task)
  }

  await Promise.all(tasks)

  if (runState.cancelled) {
    await store.updateRunStatus(db, run.id, 'cancelled')
    return
  }

  // ── Analyzing phase ──
  await store.updateRunStatus(db, run.id, 'analyzing', {
    progress: { completed: simCount, total: simCount, analyzing: 0 },
  })

  const analyses: string[] = []
  let analyzingCount = 0

  for (let simIdx = 0; simIdx < simCount; simIdx++) {
    if (runState.cancelled) break
    const results = allResults[simIdx]
    if (!results || results.length === 0) continue

    try {
      const analysisResult = await analyzeSimulation(
        registry, results, request.adminContext, traceConfig, request.analysisModel,
      )

      analyses.push(analysisResult.analysis)
      totalTokensIn += analysisResult.tokensInput
      totalTokensOut += analysisResult.tokensOutput

      // Update each result row with its analysis
      const analysisTokens = analysisResult.tokensInput + analysisResult.tokensOutput
      for (const r of results) {
        await store.updateResultAnalysis(db, r.id, analysisResult.analysis, analysisResult.model, analysisTokens)
      }

      analyzingCount++
      await store.updateRunStatus(db, run.id, 'analyzing', {
        progress: { completed: simCount, total: simCount, analyzing: analyzingCount },
      })
    } catch (err) {
      logger.warn({ err, simIdx }, 'Analysis failed for simulation')
      analyses.push(`[Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}]`)
    }
  }

  if (runState.cancelled) {
    await store.updateRunStatus(db, run.id, 'cancelled')
    return
  }

  // ── Build summary ──
  const summary = buildRunSummary(allResults, totalTokensIn, totalTokensOut, Date.now() - startMs)

  // ── Synthesize (only if N > 1) ──
  let synthesis: string | undefined
  let synthesisModel: string | undefined

  if (simCount > 1 && analyses.length > 0) {
    try {
      const synthResult = await synthesizeResults(
        registry, analyses, request.adminContext, summary, traceConfig, request.analysisModel,
      )
      synthesis = synthResult.synthesis
      synthesisModel = synthResult.model
      totalTokensIn += synthResult.tokensInput
      totalTokensOut += synthResult.tokensOutput
    } catch (err) {
      logger.warn({ err }, 'Synthesis failed')
      synthesis = `[Synthesis failed: ${err instanceof Error ? err.message : 'Unknown error'}]`
    }
  }

  // ── Complete ──
  await store.updateRunStatus(db, run.id, 'completed', {
    progress: { completed: simCount, total: simCount, analyzing: simCount },
    summary,
    synthesis,
    synthesisModel,
    tokensInput: totalTokensIn,
    tokensOutput: totalTokensOut,
  })

  // Push notification to console bell
  void notifStore.create(db, {
    source: 'trace',
    severity: 'info',
    title: `Trace completado: ${run.variant_name || 'simulación'}`,
    body: `${simCount} simulaciones — ${Math.round((Date.now() - startMs) / 1000)}s`,
    metadata: { runId: run.id, simCount },
  })

  logger.info({
    runId: run.id,
    simCount,
    durationMs: Date.now() - startMs,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
  }, 'Trace run completed')
}

// ═══════════════════════════════════════════
// Summary builder
// ═══════════════════════════════════════════

function buildRunSummary(
  allResults: ResultRow[][],
  totalTokensIn: number,
  totalTokensOut: number,
  durationMs: number,
): RunSummary {
  const intents: Record<string, number> = {}
  const toolsPlannedSet = new Set<string>()
  const toolsDryRunSet = new Set<string>()
  let totalMessages = 0
  let sumPhase2 = 0
  let sumPhase4 = 0
  let countPhase2 = 0
  let countPhase4 = 0

  for (const results of allResults) {
    if (!results) continue
    for (const r of results) {
      totalMessages++

      if (r.intent) {
        intents[r.intent] = (intents[r.intent] ?? 0) + 1
      }

      if (r.phase2_ms) { sumPhase2 += r.phase2_ms; countPhase2++ }
      if (r.phase4_ms) { sumPhase4 += r.phase4_ms; countPhase4++ }

      for (const t of r.tools_planned ?? []) toolsPlannedSet.add(t)

      if (r.tools_executed && Array.isArray(r.tools_executed)) {
        for (const t of r.tools_executed as SandboxToolResult[]) {
          if (t.mode === 'dry-run') toolsDryRunSet.add(t.tool)
        }
      }
    }
  }

  return {
    total_simulations: allResults.filter(Boolean).length,
    total_messages: totalMessages,
    intents,
    avg_phase2_ms: countPhase2 > 0 ? Math.round(sumPhase2 / countPhase2) : 0,
    avg_phase4_ms: countPhase4 > 0 ? Math.round(sumPhase4 / countPhase4) : 0,
    tools_planned: [...toolsPlannedSet],
    tools_dry_run: [...toolsDryRunSet],
    total_tokens_input: totalTokensIn,
    total_tokens_output: totalTokensOut,
    duration_ms: durationMs,
  }
}
