# Instance 4 — Integration + Globals + Versioning

> **Branch**: `reset/instance-4-integration` (from `reset`, AFTER instances 1+2+3 merged)
> **LLM**: opus
> **Parallel**: No (sequential — depends on Instance 1, 2, and 3 being merged to `reset`)
> **Scope**: Wire agentic loop into engine.ts, update types/config, adapt Phase 5, wire proactive pipeline, update all CLAUDE.md files, set v2.0.0

---

## Pre-flight: Read Before Writing Anything

Read every file listed below in full. Do not begin Step 1 until you have read all of them.

### Plans (understand the big picture)
- `/docker/luna-repo/docs/plans/reset-v2/overview.md`
- `/docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md`
- `/docker/luna-repo/docs/plans/reset-v2/instance-1-engine.md`
- `/docker/luna-repo/docs/plans/reset-v2/instance-2-prompts.md`
- `/docker/luna-repo/docs/plans/reset-v2/instance-3-proactivity-tools.md`

### Engine core (the files you will modify)
- `/docker/luna-repo/src/engine/engine.ts` — main orchestrator, 5-phase pipeline, concurrency layers (793 lines)
- `/docker/luna-repo/src/engine/types.ts` — ALL types: ContextBundle, PipelineResult, EngineConfig, etc. (648 lines)
- `/docker/luna-repo/src/engine/config.ts` — loadEngineConfig(), env/envInt/envBool/envFloat/envProvider helpers (152 lines)

### Files created by Instance 1 (agentic loop)
- `/docker/luna-repo/src/engine/agentic/types.ts` — AgenticResult, AgenticConfig, EffortLevel, ToolCallLog
- `/docker/luna-repo/src/engine/agentic/loop.ts` — runAgenticLoop() main entry
- `/docker/luna-repo/src/engine/agentic/effort-router.ts` — classifyEffort()
- `/docker/luna-repo/src/engine/agentic/dedup.ts` — tool call deduplication
- `/docker/luna-repo/src/engine/agentic/loop-detector.ts` — anti-loop with graduated thresholds
- `/docker/luna-repo/src/engine/agentic/post-processor.ts` — criticizer, formatting, TTS
- `/docker/luna-repo/src/engine/agentic/index.ts` — public re-exports

### Files created by Instance 2 (prompts)
- `/docker/luna-repo/src/engine/prompts/agentic.ts` — buildAgenticPrompt()
- `/docker/luna-repo/src/engine/prompts/context-builder.ts` — context assembly for prompts
- `/docker/luna-repo/src/engine/prompts/skills.ts` — skill stub system
- `/docker/luna-repo/src/engine/prompts/accent.ts` — accent injection

### Files created by Instance 3 (proactivity + tools + queue)
- `/docker/luna-repo/src/engine/concurrency/execution-queue.ts` — ExecutionQueue with lanes
- `/docker/luna-repo/src/engine/proactive/smart-cooldown.ts` — adaptive next_check_at
- `/docker/luna-repo/src/engine/proactive/orphan-recovery.ts` — orphan message tracking
- `/docker/luna-repo/src/engine/proactive/conversation-guard.ts` — enhanced farewell suppression
- `/docker/luna-repo/src/modules/tools/types.ts` — UPDATED with shortDescription field

### Phase 5 (you will adapt this)
- `/docker/luna-repo/src/engine/phases/phase5-validate.ts` — validate + send + persist + commitment detect (758 lines)

### Proactive pipeline (you will wire agentic loop here)
- `/docker/luna-repo/src/engine/proactive/proactive-pipeline.ts` — simplified Phase 1 + Phases 2-5 (474 lines)

### Tool system (understand for wiring)
- `/docker/luna-repo/src/modules/tools/tool-registry.ts` — ToolRegistry: getEnabledToolDefinitions(), executeTool()
- `/docker/luna-repo/src/modules/tools/tool-converter.ts` — toNativeTools()

### All CLAUDE.md files (you will update these)
- `/docker/luna-repo/CLAUDE.md` — root project overview
- `/docker/luna-repo/src/engine/CLAUDE.md` — engine architecture (major update)
- `/docker/luna-repo/src/kernel/CLAUDE.md`
- `/docker/luna-repo/src/modules/CLAUDE.md`
- `/docker/luna-repo/src/modules/engine/CLAUDE.md`
- `/docker/luna-repo/src/modules/tools/CLAUDE.md`
- `/docker/luna-repo/src/modules/prompts/CLAUDE.md`
- `/docker/luna-repo/src/engine/checkpoints/CLAUDE.md`
- `/docker/luna-repo/deploy/CLAUDE.md`

### package.json (version bump)
- `/docker/luna-repo/package.json` — currently version "0.1.0", will become "2.0.0"

---

## Critical Rules

### REUSE EVERYTHING
Before creating any function, hook, service, type, or file — check `reuse-inventory.md`. If it exists, use it. Do not duplicate.

### DO NOT Modify Files Owned by Instances 1, 2, 3
Unless fixing a compile error or integration bug. The agentic/ directory, prompts/agentic.ts, execution-queue.ts, smart-cooldown.ts, etc. belong to their respective instances.

### Feature Flags for Agentic vs Legacy
All changes must be gated by `config.engineMode`. When `engineMode === 'legacy'`, the engine MUST behave exactly as it does today (Phases 2-4 path). When `engineMode === 'agentic'` (the new default), it uses the agentic loop.

### No New DB Tables
Use existing tables: pipeline_logs, messages, sessions, tool_executions, etc.

### Compile Before Commit
Every commit must pass `npx tsc --noEmit` with zero errors.

---

## Step 0: Setup

### 0.1 Create Branch

```bash
cd /docker/luna-repo
git checkout reset
git pull origin reset
git checkout -b reset/instance-4-integration
```

### 0.2 Verify Instances 1+2+3 Are Merged

Confirm that the following directories and files exist on the `reset` branch:
```bash
# From Instance 1
ls src/engine/agentic/index.ts
ls src/engine/agentic/loop.ts
ls src/engine/agentic/types.ts
ls src/engine/agentic/effort-router.ts
ls src/engine/agentic/dedup.ts
ls src/engine/agentic/loop-detector.ts
ls src/engine/agentic/post-processor.ts

# From Instance 2
ls src/engine/prompts/agentic.ts
ls src/engine/prompts/context-builder.ts
ls src/engine/prompts/skills.ts
ls src/engine/prompts/accent.ts

# From Instance 3
ls src/engine/concurrency/execution-queue.ts
ls src/engine/proactive/smart-cooldown.ts
ls src/engine/proactive/orphan-recovery.ts
ls src/engine/proactive/conversation-guard.ts
```

If any are missing, STOP. Do not proceed until all three instances are merged.

### 0.3 Initial Compilation Check

```bash
npx tsc --noEmit
```

Record any existing errors. These must be fixed as part of this instance. If there are errors from Instance 1/2/3 code, fix those FIRST before making any changes.

### 0.4 Read All Instance Outputs

Read every file listed in 0.2 completely. Understand:
- What types does Instance 1 export from `agentic/index.ts`?
- What is the signature of `runAgenticLoop()`?
- What is the signature of `buildAgenticPrompt()`?
- What is the signature of `classifyEffort()`?
- What does `postProcess()` return? Is it a `CompositorOutput`?
- What does `ExecutionQueue` export? How are lanes defined?

Record the exact function signatures. You will use them in Steps 3 and 5.

---

## Step 1: Extend `src/engine/config.ts`

### 1.1 Add New Config Keys

Add the following keys to the `loadEngineConfig()` return object. Use the existing `env()`, `envInt()`, `envBool()`, `envFloat()`, `envProvider()` helpers that are already defined in the file. Do NOT import from `kernel/config-helpers.ts` — this file has its own local helpers.

Add AFTER the existing `checkpointCleanupDays` line (line ~150), before the closing `}`:

```typescript
    // ═══ Agentic mode (v2.0.0) ═══
    engineMode: env('ENGINE_MODE', 'agentic') as 'agentic' | 'legacy',
    agenticMaxToolTurns: envInt('AGENTIC_MAX_TOOL_TURNS', 10),
    agenticEffortDefault: env('AGENTIC_EFFORT_DEFAULT', 'medium') as 'low' | 'medium' | 'high',
    agenticToolDedupEnabled: envBool('AGENTIC_TOOL_DEDUP_ENABLED', true),
    agenticLoopDetectionEnabled: envBool('AGENTIC_LOOP_DETECTION_ENABLED', true),
    agenticLoopWarnThreshold: envInt('AGENTIC_LOOP_WARN_THRESHOLD', 3),
    agenticLoopBlockThreshold: envInt('AGENTIC_LOOP_BLOCK_THRESHOLD', 5),
    agenticLoopCircuitThreshold: envInt('AGENTIC_LOOP_CIRCUIT_THRESHOLD', 8),
    agenticPartialRecoveryEnabled: envBool('AGENTIC_PARTIAL_RECOVERY_ENABLED', true),
    agenticCriticizerEnabled: envBool('AGENTIC_CRITICIZER_ENABLED', true),

    // ═══ Execution Queue lanes (v2.0.0) ═══
    executionQueueReactiveConcurrency: envInt('EXECUTION_QUEUE_REACTIVE_CONCURRENCY', 8),
    executionQueueProactiveConcurrency: envInt('EXECUTION_QUEUE_PROACTIVE_CONCURRENCY', 3),
    executionQueueBackgroundConcurrency: envInt('EXECUTION_QUEUE_BACKGROUND_CONCURRENCY', 2),
    executionQueueGlobalMax: envInt('EXECUTION_QUEUE_GLOBAL_MAX', 12),
```

### 1.2 Verify Helper Functions

The file already defines `env()`, `envInt()`, `envBool()`, `envFloat()`, `envProvider()` at the top. Confirm these are sufficient. No new helpers needed.

### 1.3 Compile Check

```bash
npx tsc --noEmit
```

This WILL fail because EngineConfig interface in types.ts does not yet have the new fields. That is expected — Step 2 fixes it.

---

## Step 2: Extend `src/engine/types.ts`

### 2.1 Import and Re-export Agentic Types

At the TOP of the file (after the existing channel imports, around line 4), add:

```typescript
// Re-export agentic types for consumers
export type { AgenticResult, AgenticConfig, EffortLevel, ToolCallLog } from './agentic/types.js'
```

**IMPORTANT**: Verify the exact export names by reading `src/engine/agentic/types.ts`. If Instance 1 used different names, use those instead. Do NOT guess.

### 2.2 Extend PipelineResult

Add two optional fields to the `PipelineResult` interface (around line 303). Add after the existing `subagentIterationsUsed` field:

```typescript
  /** Present when ENGINE_MODE='agentic'. Contains full agentic loop trace. */
  agenticResult?: import('./agentic/types.js').AgenticResult
  /** Effort level used by the agentic loop (low/medium/high). */
  effortLevel?: import('./agentic/types.js').EffortLevel
```

Use inline `import()` types to avoid adding the re-export to the top-level imports (prevents circular dependency risk).

### 2.3 Extend EngineConfig

Add the new fields to the `EngineConfig` interface. Add AFTER the existing `checkpointCleanupDays` field (around line 647):

```typescript
  // ═══ Agentic mode (v2.0.0) ═══
  /** 'agentic' (default) uses single LLM loop with tools. 'legacy' uses Phases 2-4. */
  engineMode: 'agentic' | 'legacy'
  /** Max tool-use round trips in agentic loop before forcing a response. */
  agenticMaxToolTurns: number
  /** Default effort level for agentic loop ('low' | 'medium' | 'high'). */
  agenticEffortDefault: 'low' | 'medium' | 'high'
  /** Enable tool call deduplication (skip identical tool calls). */
  agenticToolDedupEnabled: boolean
  /** Enable anti-loop detection with graduated thresholds. */
  agenticLoopDetectionEnabled: boolean
  /** Number of similar tool calls before warn. */
  agenticLoopWarnThreshold: number
  /** Number of similar tool calls before blocking that tool. */
  agenticLoopBlockThreshold: number
  /** Number of total loop detections before circuit-breaking the entire loop. */
  agenticLoopCircuitThreshold: number
  /** Enable partial text recovery on timeout. */
  agenticPartialRecoveryEnabled: boolean
  /** Enable criticizer (smart mode: only for complex messages). */
  agenticCriticizerEnabled: boolean

  // ═══ Execution Queue lanes (v2.0.0) ═══
  /** Max concurrent reactive pipelines in execution queue. */
  executionQueueReactiveConcurrency: number
  /** Max concurrent proactive pipelines in execution queue. */
  executionQueueProactiveConcurrency: number
  /** Max concurrent background tasks in execution queue. */
  executionQueueBackgroundConcurrency: number
  /** Global max across all lanes. */
  executionQueueGlobalMax: number
```

### 2.4 DO NOT Modify These Types

- `ContextBundle` — stays exactly as-is. The agentic loop receives it as input.
- `EvaluatorOutput` — stays. Used by legacy mode.
- `ExecutionOutput` — stays. Used by legacy mode.
- `CompositorOutput` — stays. The agentic post-processor MUST return this same type.
- `HistoryMessage`, `ContactInfo`, `SessionInfo`, `CampaignInfo`, `KnowledgeMatch` — all stay.

### 2.5 Compile Check

```bash
npx tsc --noEmit
```

Both config.ts and types.ts should now be in sync. Fix any errors.

---

## Step 3: Modify `src/engine/engine.ts` — THE BIG ONE

This is the main orchestrator. You will add the agentic path alongside the existing legacy path. The existing code stays intact behind the `legacy` branch of the if-statement.

### 3.1 Add New Imports

Add these imports at the TOP of engine.ts, AFTER the existing imports (around line 24):

```typescript
// Agentic mode (v2.0.0)
import { runAgenticLoop, classifyEffort, postProcess } from './agentic/index.js'
import { buildAgenticPrompt } from './prompts/agentic.js'
import type { AgenticConfig } from './agentic/types.js'
```

**IMPORTANT**: Verify the exact import paths and export names by reading:
1. `src/engine/agentic/index.ts` — what does it export?
2. `src/engine/prompts/agentic.ts` — what does it export?

If the actual exports differ from the above, use the real names. Do NOT assume.

### 3.2 Modify `processMessageInner()` — Add Agentic Path

Locate the `processMessageInner()` function (starts around line 186). The key modification point is AFTER Phase 1 completes and AFTER the test-mode gate, unregistered-contact gate, and channel:read signal (around line 297).

Currently the code flows:
1. Phase 1 (line ~203)
2. ACK signal (line ~219)
3. Test mode gate (line ~239)
4. Unregistered contact gate (line ~257)
5. channel:read signal (line ~292)
6. Phase 2 (line ~300)
7. Checkpoint creation (line ~314)
8. Phase 3+4 with aviso timer (line ~333)
9. Phase 5 (line ~472)

The agentic/legacy split goes at step 6. Replace the code from the `// === PHASE 2` comment (line ~299) through the Phase 5 call and return (line ~538) with a conditional block.

#### Structure of the replacement:

```typescript
    // ═══ SIGNAL: READ (mark as read) — before processing ═══
    registry.runHook('channel:read', { /* ... existing code ... */ }).catch(() => {})

    if (engineConfig.engineMode === 'agentic') {
      // ════════════════════════════════════════════
      // AGENTIC PATH (v2.0.0)
      // ════════════════════════════════════════════
      return await processAgentic(ctx, message, db, redis, totalStart, signalTo, pipelineState)
    } else {
      // ════════════════════════════════════════════
      // LEGACY PATH (Phases 2-4, unchanged)
      // ════════════════════════════════════════════
      // ... ALL existing Phase 2-5 code goes here, UNCHANGED ...
    }
```

### 3.3 Create the `processAgentic()` Helper Function

Add a new function AFTER `processMessageInner()`. This keeps the main function clean and avoids deep nesting.

```typescript
/**
 * Agentic processing path (v2.0.0).
 * Replaces Phases 2-4 with a single LLM loop that uses tools directly.
 * Phase 1 (context) and Phase 5 (validate+send) are reused.
 */
async function processAgentic(
  ctx: ContextBundle,
  message: IncomingMessage,
  db: import('pg').Pool,
  redis: import('ioredis').Redis,
  totalStart: number,
  signalTo: string,
  pipelineState: { failed: boolean; completed: boolean },
): Promise<PipelineResult> {
  const phase1DurationMs = Date.now() - totalStart // Phase 1 already ran

  // 1. Classify effort level
  const effort = classifyEffort(ctx, engineConfig)

  // 2. Build agentic config from engine config
  const agenticConfig: AgenticConfig = {
    maxToolTurns: engineConfig.agenticMaxToolTurns,
    effort,
    dedupEnabled: engineConfig.agenticToolDedupEnabled,
    loopDetection: engineConfig.agenticLoopDetectionEnabled,
    loopWarnThreshold: engineConfig.agenticLoopWarnThreshold,
    loopBlockThreshold: engineConfig.agenticLoopBlockThreshold,
    loopCircuitThreshold: engineConfig.agenticLoopCircuitThreshold,
    partialRecoveryEnabled: engineConfig.agenticPartialRecoveryEnabled,
    criticizerEnabled: engineConfig.agenticCriticizerEnabled,
    criticizerMode: engineConfig.criticizerMode,
  }

  // 3. Get tool definitions (two-tier: short descriptions for LLM)
  const toolRegistry = registry.getOptional<import('../modules/tools/tool-registry.js').ToolRegistry>('tools:registry')
  const toolDefs = toolRegistry?.getEnabledToolDefinitions(ctx.userType) ?? []
  const { toNativeTools } = await import('../modules/tools/tool-converter.js')

  // Select provider based on effort: low=toolsProvider, medium=respondProvider, high=complexProvider
  const provider = effort === 'high' ? engineConfig.complexProvider
    : effort === 'low' ? engineConfig.toolsProvider
    : engineConfig.respondProvider
  const nativeTools = toNativeTools(toolDefs, provider)

  // 4. Build system prompt (from Instance 2)
  const { system, userMessage } = await buildAgenticPrompt(ctx, toolDefs, registry)

  // 5. Aviso timer (same pattern as legacy, starts before agentic loop)
  const avisoConfig = getAvisoConfig(ctx.message.channelName)
  let avisoSentAt: number | undefined
  const channelTone = getChannelTone(ctx.message.channelName)

  const avisoTimer = avisoConfig.triggerMs > 0
    ? setTimeout(async () => {
        if (pipelineState.completed) return
        if (pipelineState.failed) {
          try {
            const errorMsg = pickErrorFallback(channelTone)
            await sendAviso(ctx, errorMsg, registry)
          } catch (err) {
            logger.warn({ err, traceId: ctx.traceId }, 'Failed to send error fallback via aviso')
          }
          return
        }
        avisoSentAt = Date.now()
        try {
          const ackMsg = await generateAck({
            contactName: ctx.contact?.displayName ?? '',
            userMessage: (ctx.normalizedText ?? ctx.message.content.text ?? '').slice(0, 200),
            actionType: 'thinking',
            tone: channelTone,
          }, registry)
          await sendAviso(ctx, ackMsg, registry)
        } catch (err) {
          logger.warn({ err, traceId: ctx.traceId }, 'Failed to send aviso de proceso')
        }
      }, avisoConfig.triggerMs)
    : null

  // 6. SIGNAL: COMPOSING — before agentic loop
  registry.runHook('channel:composing', {
    channel: message.channelName,
    to: signalTo,
    mode: ctx.responseFormat === 'audio' ? 'recording' : 'composing',
    correlationId: ctx.traceId,
  }).catch(() => {})

  // 7. Run agentic loop (from Instance 1)
  const agenticStart = Date.now()
  const agenticResult = await runAgenticLoop(ctx, system, nativeTools, agenticConfig, registry)
  const agenticDurationMs = Date.now() - agenticStart

  logger.info({
    traceId: ctx.traceId,
    mode: 'agentic',
    effort,
    durationMs: agenticDurationMs,
    toolCalls: agenticResult.toolCallsLog?.length ?? 0,
    turns: agenticResult.turns ?? 0,
  }, 'Agentic loop done')

  // 8. Post-process (criticizer, formatting, TTS)
  const postStart = Date.now()
  const compositorOutput = await postProcess(agenticResult, ctx, engineConfig, registry)
  const postDurationMs = Date.now() - postStart

  pipelineState.completed = true
  if (avisoTimer) clearTimeout(avisoTimer)

  // Hold response after aviso if needed
  if (avisoSentAt !== undefined) {
    const elapsed = Date.now() - avisoSentAt
    const holdMs = avisoConfig.holdMs - elapsed
    if (holdMs > 0) {
      logger.info({ traceId: ctx.traceId, holdMs }, 'Reteniendo respuesta tras aviso de proceso')
      await new Promise(resolve => setTimeout(resolve, holdMs))
    }
  }

  // 9. Phase 5: Validate + Send + Persist
  const p5Start = Date.now()
  const delivery = await phase5Validate(ctx, compositorOutput, null, registry, db, redis, engineConfig)
  const phase5DurationMs = Date.now() - p5Start

  const totalDurationMs = Date.now() - totalStart

  logger.info({
    traceId: ctx.traceId,
    phase: 5,
    durationMs: phase5DurationMs,
    sent: delivery.sent,
    totalDurationMs,
  }, 'Agentic pipeline complete')

  // Pipeline log (fire-and-forget)
  const memMgr = registry.getOptional<import('../modules/memory/memory-manager.js').MemoryManager>('memory:manager')
  if (memMgr) {
    const toolsCalled = agenticResult.toolCallsLog?.map(t => t.name) ?? []
    memMgr.savePipelineLog({
      messageId: ctx.message.id,
      agentId: ctx.agentId,
      contactId: ctx.contactId ?? null,
      sessionId: ctx.session.id,
      phase1Ms: phase1DurationMs,
      phase2Ms: agenticDurationMs,   // agentic loop replaces Phases 2+3+4
      phase3Ms: 0,
      phase4Ms: postDurationMs,
      phase5Ms: phase5DurationMs,
      totalMs: totalDurationMs,
      toolsCalled,
    }).catch(err => logger.warn({ err, traceId: ctx.traceId }, 'Failed to save pipeline log'))
  }

  // Extreme logging: outbound response
  logChannelMessage({
    channel: message.channelName,
    direction: 'outbound',
    contactId: message.from,
    messageType: 'text',
    textPreview: compositorOutput.responseText,
    metadata: { traceId: ctx.traceId, totalDurationMs, sent: delivery.sent, mode: 'agentic' },
  }).catch(() => {})

  return {
    traceId: ctx.traceId,
    success: delivery.sent,
    phase1DurationMs,
    phase2DurationMs: agenticDurationMs,
    phase3DurationMs: 0,
    phase4DurationMs: postDurationMs,
    phase5DurationMs,
    totalDurationMs,
    responseText: compositorOutput.responseText,
    deliveryResult: delivery,
    agenticResult,
    effortLevel: effort,
    replanAttempts: 0,       // no replanning in agentic mode
    subagentIterationsUsed: 0, // subagents are tools in agentic mode
  }
}
```

### 3.4 Important Notes on processAgentic()

**Verify the following before writing the actual code:**

1. **`runAgenticLoop()` signature**: Read `agentic/loop.ts` and `agentic/index.ts` to get the exact parameter order and types. The pseudocode above assumes `(ctx, system, nativeTools, agenticConfig, registry)` but Instance 1 may have used different parameter names or order.

2. **`buildAgenticPrompt()` return type**: Read `prompts/agentic.ts`. The pseudocode assumes it returns `{ system: string, userMessage: string }` but it may return differently.

3. **`postProcess()` return type**: Read `agentic/post-processor.ts`. It MUST return a `CompositorOutput` (same type as Phase 4). If it returns a different type, you need an adapter.

4. **`classifyEffort()` signature**: Read `agentic/effort-router.ts`. Pseudocode assumes `(ctx, engineConfig)`.

5. **`AgenticConfig` fields**: Read `agentic/types.ts`. The pseudocode assumes specific field names. Use the actual field names.

If ANY of these differ from the pseudocode, adjust accordingly. The pseudocode is a guide, not a contract.

### 3.5 Move Existing Legacy Code into Else Branch

The existing Phase 2-5 code (lines ~299-538) moves into the `else` branch. Do NOT modify it. Keep every line, every variable, every comment exactly as-is.

### 3.6 Update `reloadEngineConfig()`

In the `reloadEngineConfig()` function (around line 612), add a log entry for the new mode:

```typescript
  logger.info({
    engineMode: engineConfig.engineMode,
    maxPipelines: engineConfig.maxConcurrentPipelines,
    maxQueue: engineConfig.maxQueueSize,
    testMode: engineConfig.testMode,
  }, 'Engine config hot-reloaded from console')
```

### 3.7 Compile Check

```bash
npx tsc --noEmit
```

This will fail if Phase 5's signature doesn't accept `null` for the evaluation parameter yet. That is fixed in Step 4.

---

## Step 4: Adapt `src/engine/phases/phase5-validate.ts`

### 4.1 Problem

Phase 5 currently requires `evaluation: EvaluatorOutput` as a parameter. In agentic mode, there is no separate Phase 2, so there is no `EvaluatorOutput`. The agentic loop produces an `AgenticResult` instead.

### 4.2 Make `evaluation` Parameter Optional

Change the function signature from:

```typescript
export async function phase5Validate(
  ctx: ContextBundle,
  composed: CompositorOutput,
  evaluation: EvaluatorOutput,
  registry: Registry,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): Promise<DeliveryResult> {
```

To:

```typescript
export async function phase5Validate(
  ctx: ContextBundle,
  composed: CompositorOutput,
  evaluation: EvaluatorOutput | null,
  registry: Registry,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): Promise<DeliveryResult> {
```

### 4.3 Guard All evaluation.* Access

Search for every place in phase5-validate.ts that reads from `evaluation`. There are currently these usages:

1. **`persistMessages()`** (line ~604-685): Uses `evaluation.intent` and `evaluation.emotion` for message persistence. When evaluation is null, use `'agentic'` as the intent and `''` as the emotion.

2. **Objection data recording** (line ~166-178): Uses `evaluation.objectionType` and `evaluation.objectionStep`. When evaluation is null, skip this block entirely.

3. **Campaign match recording** (line ~181-193): Does NOT use evaluation. No change needed.

4. **Farewell detection** (line ~197): Uses `evaluation.intent === 'farewell'`. When evaluation is null, skip farewell marking (the agentic loop handles this differently).

5. **`updateCommitmentIfNeeded()`** in proactive-pipeline.ts: Uses `evaluation.intent`. This is a separate file — handled in Step 5.

#### Changes to `persistMessages()`:

The `persistMessages` function receives `evaluation: EvaluatorOutput` as a parameter. Change it to accept `evaluation: EvaluatorOutput | null`:

```typescript
async function persistMessages(
  ctx: ContextBundle,
  responseText: string,
  evaluation: EvaluatorOutput | null,
  db: Pool,
  memoryManager: MemoryManager | null,
): Promise<void> {
```

Inside, guard the accesses:
```typescript
  intent: evaluation?.intent ?? 'agentic',
  emotion: evaluation?.emotion ?? '',
```

#### Changes to the main function body:

```typescript
  // 5b. Record objection data (only in legacy mode with evaluation)
  if (evaluation?.objectionType && ctx.contactId && memoryManager) {
    // ... existing code unchanged ...
  }

  // 6. Proactive guard signals
  if (deliveryResult.sent && ctx.contactId) {
    if (evaluation?.intent === 'farewell') {
      markFarewell(ctx.contactId, redis).catch(() => {})
    }
    // ... rest unchanged ...
  }
```

### 4.4 Update the Call Site in engine.ts

In the legacy path (the else branch from Step 3), the call stays exactly as-is:
```typescript
const delivery = await phase5Validate(ctx, composed, evaluation, registry, db, redis, engineConfig)
```

In the agentic path (processAgentic function), pass `null`:
```typescript
const delivery = await phase5Validate(ctx, compositorOutput, null, registry, db, redis, engineConfig)
```

### 4.5 Update the Call Site in proactive-pipeline.ts

The call in `processProactive()` stays as-is for now (it always has an evaluation). In Step 5 we will add the agentic path for proactive.

### 4.6 Compile Check

```bash
npx tsc --noEmit
```

---

## Step 5: Wire Proactive Pipeline to Agentic Loop

### 5.1 Overview

When `ENGINE_MODE='agentic'`, the proactive pipeline should use the agentic loop instead of Phases 2-4. The proactive pipeline already builds a `ProactiveContextBundle` in its simplified Phase 1. That bundle is a superset of `ContextBundle`, so it can be passed directly to the agentic loop.

### 5.2 Add Agentic Imports to proactive-pipeline.ts

Add after the existing imports:

```typescript
// Agentic mode (v2.0.0)
import { runAgenticLoop, classifyEffort, postProcess } from '../agentic/index.js'
import { buildAgenticPrompt } from '../prompts/agentic.js'
import type { AgenticConfig } from '../agentic/types.js'
import { loadEngineConfig } from '../config.js'
```

**Note**: `loadEngineConfig` might already be imported indirectly via the `engineConfig` parameter. Check whether `proactive-pipeline.ts` needs its own config or uses the one passed as a parameter.

### 5.3 Add Agentic Branch to `processProactive()`

After the simplified Phase 1 completes and before Phase 2, add the conditional:

```typescript
    // ═══ SIMPLIFIED PHASE 1 ═══
    const p1Start = Date.now()
    const ctx = await buildProactiveContext(candidate, db, redis, registry, engineConfig, traceId)
    const phase1DurationMs = Date.now() - p1Start

    logger.info({ traceId, phase: 1, durationMs: phase1DurationMs }, 'Proactive phase 1 done')

    if (engineConfig.engineMode === 'agentic') {
      // ═══ AGENTIC PATH ═══
      return await processProactiveAgentic(ctx, candidate, db, redis, registry, engineConfig, proactiveConfig, traceId, phase1DurationMs, totalStart)
    }

    // ═══ LEGACY PATH (existing Phases 2-5) ═══
    // ... existing code unchanged below ...
```

### 5.4 Create `processProactiveAgentic()` Helper

Add a new function at the bottom of the file (before the existing helper functions):

```typescript
/**
 * Agentic processing for proactive pipeline.
 * Uses agentic loop with limited tools and proactive context.
 */
async function processProactiveAgentic(
  ctx: ProactiveContextBundle,
  candidate: ProactiveCandidate,
  db: Pool,
  redis: Redis,
  registry: Registry,
  engineConfig: EngineConfig,
  proactiveConfig: ProactiveConfig,
  traceId: string,
  phase1DurationMs: number,
  totalStart: number,
): Promise<PipelineResult> {
  // 1. Classify effort (proactive is usually low effort)
  const effort = classifyEffort(ctx, engineConfig)

  // 2. Build agentic config
  const agenticConfig: AgenticConfig = {
    maxToolTurns: Math.min(engineConfig.agenticMaxToolTurns, 5), // limit tools for proactive
    effort,
    dedupEnabled: engineConfig.agenticToolDedupEnabled,
    loopDetection: engineConfig.agenticLoopDetectionEnabled,
    loopWarnThreshold: engineConfig.agenticLoopWarnThreshold,
    loopBlockThreshold: engineConfig.agenticLoopBlockThreshold,
    loopCircuitThreshold: engineConfig.agenticLoopCircuitThreshold,
    partialRecoveryEnabled: engineConfig.agenticPartialRecoveryEnabled,
    criticizerEnabled: false, // no criticizer for proactive
    criticizerMode: 'disabled',
  }

  // 3. Get tools (limited set for proactive)
  const toolRegistry = registry.getOptional<import('../../modules/tools/tool-registry.js').ToolRegistry>('tools:registry')
  const toolDefs = toolRegistry?.getEnabledToolDefinitions('lead') ?? []
  const { toNativeTools } = await import('../../modules/tools/tool-converter.js')
  const nativeTools = toNativeTools(toolDefs, engineConfig.proactiveProvider)

  // 4. Build system prompt with proactive context
  const { system } = await buildAgenticPrompt(ctx, toolDefs, registry)

  // 5. Run agentic loop
  const agenticStart = Date.now()
  const agenticResult = await runAgenticLoop(ctx, system, nativeTools, agenticConfig, registry)
  const agenticDurationMs = Date.now() - agenticStart

  // Check for NO_ACTION (agentic equivalent: empty/null response)
  if (!agenticResult.responseText || agenticResult.responseText.trim() === '') {
    logger.info({ traceId }, 'Proactive agentic loop returned no response — treating as NO_ACTION')
    await logOutreach(db, {
      contactId: candidate.contactId,
      triggerType: candidate.triggerType,
      triggerId: candidate.triggerId,
      channel: candidate.channel,
      actionTaken: 'no_action',
    })
    return {
      traceId, success: true,
      phase1DurationMs, phase2DurationMs: agenticDurationMs,
      phase3DurationMs: 0, phase4DurationMs: 0, phase5DurationMs: 0,
      totalDurationMs: Date.now() - totalStart,
      agenticResult, effortLevel: effort,
      replanAttempts: 0, subagentIterationsUsed: 0,
    }
  }

  // 6. Post-process
  const compositorOutput = await postProcess(agenticResult, ctx, engineConfig, registry)

  // 7. Phase 5: Validate + Send
  const p5Start = Date.now()
  const delivery = await phase5Validate(ctx, compositorOutput, null, registry, db, redis, engineConfig)
  const phase5DurationMs = Date.now() - p5Start

  const totalDurationMs = Date.now() - totalStart

  // Post-send bookkeeping (same as legacy)
  if (delivery.sent) {
    await Promise.allSettled([
      setCooldown(candidate.contactId, redis, proactiveConfig),
      incrementProactiveCount(candidate.contactId, redis),
      logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'sent',
        messageId: delivery.channelMessageId,
      }),
    ])
  } else {
    await logOutreach(db, {
      contactId: candidate.contactId,
      triggerType: candidate.triggerType,
      triggerId: candidate.triggerId,
      channel: candidate.channel,
      actionTaken: 'error',
      metadata: { error: delivery.error },
    })
  }

  // Pipeline log (fire-and-forget)
  const memMgr = registry.getOptional<import('../../modules/memory/memory-manager.js').MemoryManager>('memory:manager')
  if (memMgr && candidate.contactId) {
    memMgr.savePipelineLog({
      messageId: traceId,
      agentId: ctx.agentId,
      contactId: candidate.contactId,
      sessionId: ctx.session.id,
      phase1Ms: phase1DurationMs,
      phase2Ms: agenticDurationMs,
      phase3Ms: 0, phase4Ms: 0,
      phase5Ms: phase5DurationMs,
      totalMs: totalDurationMs,
      toolsCalled: agenticResult.toolCallsLog?.map(t => t.name) ?? [],
    }).catch(() => {})
  }

  return {
    traceId, success: delivery.sent,
    phase1DurationMs, phase2DurationMs: agenticDurationMs,
    phase3DurationMs: 0, phase4DurationMs: 0, phase5DurationMs,
    totalDurationMs,
    responseText: compositorOutput.responseText,
    deliveryResult: delivery,
    agenticResult, effortLevel: effort,
    replanAttempts: 0, subagentIterationsUsed: 0,
  }
}
```

**IMPORTANT**: Verify that `logOutreach`, `setCooldown`, and `incrementProactiveCount` are accessible within this file. They are already imported/defined in `proactive-pipeline.ts`, so they should work.

### 5.5 Compile Check

```bash
npx tsc --noEmit
```

---

## Step 6: Create Version Bump Script

### 6.1 Create `scripts/bump-version.sh`

```bash
#!/usr/bin/env bash
# LUNA Version Bump Script
# Usage: ./scripts/bump-version.sh [major|minor|patch]
#
# Reads current version from package.json, calculates new version,
# shows the change, and asks for user confirmation before applying.
# Creates a git tag but does NOT push.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PACKAGE_JSON="$REPO_ROOT/package.json"

# Parse current version
CURRENT=$(node -p "require('$PACKAGE_JSON').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

BUMP_TYPE="${1:-}"

if [[ -z "$BUMP_TYPE" ]]; then
  echo "Usage: $0 [major|minor|patch]"
  echo "Current version: $CURRENT"
  exit 1
fi

case "$BUMP_TYPE" in
  major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  *)
    echo "Error: Invalid bump type '$BUMP_TYPE'. Use major, minor, or patch."
    exit 1
    ;;
esac

echo ""
echo "  Current version: $CURRENT"
echo "  New version:     $NEW_VERSION"
echo "  Bump type:       $BUMP_TYPE"
echo ""

read -rp "Confirm version bump to $NEW_VERSION? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# Update package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Updated package.json to version $NEW_VERSION"

# Create git tag
git -C "$REPO_ROOT" tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
echo "Created git tag v$NEW_VERSION"

echo ""
echo "Done. Run 'git push origin v$NEW_VERSION' when ready to publish."
```

### 6.2 Make Executable

```bash
chmod +x scripts/bump-version.sh
```

---

## Step 7: Set Version to v2.0.0

### 7.1 Update package.json

Change the `"version"` field from `"0.1.0"` to `"2.0.0"`:

```json
{
  "name": "luna",
  "version": "2.0.0",
  ...
}
```

Do NOT add a `"versionPolicy"` field to package.json (that is not a standard npm field). Instead, document the policy in CLAUDE.md.

### 7.2 Create CHANGELOG.md

Create `/docker/luna-repo/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to LUNA will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Policy**: Every version bump requires explicit user confirmation before execution.

## [2.0.0] - 2026-04-02

### Added
- **Agentic loop architecture**: Single LLM call with tools replaces Phases 2+3+4 (evaluate+execute+compose). Set `ENGINE_MODE=agentic` (default).
- **Effort router**: Classifies message complexity (low/medium/high) to select model and tool set.
- **Tool dedup cache**: Skips identical tool calls within the same loop.
- **Loop detection**: Graduated thresholds (warn/block/circuit-break) prevent infinite tool loops.
- **Partial recovery**: Extracts usable text from timed-out agentic loops.
- **Dynamic prompt assembly**: Identity, job, guardrails, accent, skills, tool catalog assembled per-request.
- **Skills system**: On-demand detailed tool descriptions loaded only when needed.
- **Accent injection**: Dynamic accent/style from config_store.
- **Smart cooldown**: Adaptive `next_check_at` for proactive outreach.
- **Orphan recovery**: Tracks and retries messages that never got a response.
- **Conversation guard**: Enhanced farewell suppression for proactive flows.
- **Execution queue**: Lane-based dispatch (reactive > proactive > background) with per-lane concurrency.
- **Two-tier tool descriptions**: Short descriptions for LLM context, full descriptions loaded on demand.
- **Version bump script**: `scripts/bump-version.sh` with user confirmation.

### Changed
- `ENGINE_MODE` defaults to `'agentic'`. Set `ENGINE_MODE=legacy` for previous behavior.
- Phase 5 now accepts optional evaluation parameter (null in agentic mode).
- Proactive pipeline uses agentic loop when `ENGINE_MODE=agentic`.
- Pipeline logs map agentic loop duration to `phase2Ms` (replaces evaluate+execute).

### Deprecated
- **Legacy mode** (Phases 2-4): Still available via `ENGINE_MODE=legacy` but no longer actively developed.
- `phase2-evaluate.ts`, `phase3-execute.ts`, `phase4-compose.ts`: Kept for legacy mode only.
- `prompts/evaluator.ts`, `prompts/compositor.ts`: Kept for legacy mode only.

### Migration
- No database changes required. No new migrations.
- Set `ENGINE_MODE=legacy` to maintain previous behavior during testing.
- Gradually switch to `ENGINE_MODE=agentic` per-environment.
```

---

## Step 8: Update ALL CLAUDE.md Files

### 8.1 Update `/docker/luna-repo/CLAUDE.md` (Root)

#### Changes:
1. Add version line: `Version: v2.0.0 (see CHANGELOG.md)`
2. Update "Arquitectura" section to mention agentic mode as default
3. Add to the directory structure:
   ```
   engine/
     agentic/         — agentic loop (v2.0.0): loop, effort router, dedup, loop detector, post-processor
     prompts/
       agentic.ts     — dynamic prompt assembly for agentic mode
       skills.ts      — skill stub system
       accent.ts      — accent injection
     concurrency/
       execution-queue.ts — lane-based dispatch (reactive/proactive/background)
   ```
4. Update pipeline description: "Pipeline de 5 pasos" becomes "Pipeline agentic (default) con fallback a 5 pasos legacy"
5. Add to "Principios": `ENGINE_MODE controla agentic (default) vs legacy. Version bumps requieren confirmacion del usuario.`
6. Update version policy reference to CHANGELOG.md
7. Add CHANGELOG.md to the file listing

#### DO NOT change:
- The "Lo que NO hacer" section (all rules still apply)
- The module listing (unless adding new entries)
- The migration system documentation
- The deploy section

### 8.2 Update `/docker/luna-repo/src/engine/CLAUDE.md`

This is the MAJOR update. Replace the current content with an updated version that:

1. **Title**: Change to `# Engine — Pipeline de procesamiento de mensajes (v2.0.0)`
2. **Intro**: Add: `Default mode: agentic (single LLM loop with tools). Legacy mode: 5-phase pipeline (behind ENGINE_MODE=legacy flag).`
3. **Files section**: Add the new directories:
   ```
   agentic/
     index.ts            — public re-exports
     types.ts            — AgenticResult, AgenticConfig, EffortLevel, ToolCallLog
     loop.ts             — runAgenticLoop() main entry
     effort-router.ts    — classifyEffort() complexity classification
     dedup.ts            — tool call deduplication cache
     loop-detector.ts    — anti-loop with graduated thresholds
     post-processor.ts   — criticizer, formatting, TTS → CompositorOutput
   ```
4. **Add "Flujo agentic (default)" section** BEFORE the existing "Flujo reactivo":
   ```
   ## Flujo agentic (default, v2.0.0)

   1. Semaphore acquire → Contact lock → processMessageInner()
   2. Phase 1: unchanged (→ ContextBundle)
   3. Test mode gate, unregistered gate: unchanged
   4. Effort classification: low/medium/high → model selection
   5. Prompt assembly: identity + job + guardrails + accent + skills + tools
   6. Agentic loop: single LLM call → tool calls → feed results → repeat → final response
   7. Post-processing: criticizer (optional) + formatForChannel + TTS
   8. Phase 5: validate, send, persist (evaluation=null)
   ```
5. **Rename existing "Flujo reactivo" to "Flujo legacy (ENGINE_MODE=legacy)"**
6. **Add new config options** to a "Config (v2.0.0)" section
7. **Update "Proactivo" section**: Add note about agentic mode usage
8. **Update "Trampas" section**: Add agentic-specific traps:
   - In agentic mode, evaluation is null in Phase 5
   - Effort router may select different models than respondModel
   - Proactive agentic limits tools to 5 turns max
   - Agentic loop duration maps to phase2Ms in pipeline_logs

### 8.3 Update `/docker/luna-repo/src/modules/tools/CLAUDE.md`

Add a section about two-tier descriptions:
```
## Two-tier tool descriptions (v2.0.0)

Tools now have `shortDescription` (sent to LLM in tool catalog) and full `description` (loaded on demand via skills system). The agentic loop uses shortDescription to reduce context size.
```

### 8.4 Update `/docker/luna-repo/src/modules/prompts/CLAUDE.md`

Add section about new prompt files:
```
## Agentic prompt system (v2.0.0)

New files in src/engine/prompts/:
- agentic.ts — buildAgenticPrompt(): assembles system prompt for agentic loop
- context-builder.ts — context assembly shared between evaluator and agentic
- skills.ts — skill stubs and on-demand loading
- accent.ts — dynamic accent injection from config_store
```

### 8.5 Update `/docker/luna-repo/src/modules/engine/CLAUDE.md`

Add note that engine now supports agentic mode. The engine module wrapper delegates to the engine — note the new ENGINE_MODE config option.

### 8.6 Other CLAUDE.md Files

For these files, add a brief note about v2.0.0 only if directly relevant:
- `src/engine/checkpoints/CLAUDE.md` — Note: checkpoints are optional in agentic mode (no multi-step execution plan to checkpoint)
- `deploy/CLAUDE.md` — Note: new env vars for ENGINE_MODE, AGENTIC_* prefixed vars

Do NOT update CLAUDE.md files that are unrelated to the engine changes (kernel, memory, whatsapp, gmail, etc.).

---

## Step 9: Final Compilation Check

### 9.1 Full Compile

```bash
npx tsc --noEmit
```

Fix ALL errors. Common issues to expect:

1. **Import path errors**: Instance 1/2/3 files may use relative imports that break when called from engine.ts. Fix the import paths.

2. **Type mismatches**: The agentic loop may return types that don't exactly match what engine.ts expects. Add adapters or type assertions where needed.

3. **Missing exports**: Instance 1's `index.ts` may not export everything you need. If so, add the missing exports to `agentic/index.ts`.

4. **Circular dependencies**: If engine.ts imports from agentic/ and agentic/ imports types from engine/types.ts, this is fine (types-only imports don't create circular deps at runtime). But if agentic/ imports functions from engine.ts, that IS circular. Use registry pattern instead.

### 9.2 Check for Circular Dependencies

```bash
# Quick check: look for agentic/ files importing from engine.ts
grep -r "from.*engine\.js" src/engine/agentic/ || true
grep -r "from.*engine\.ts" src/engine/agentic/ || true
```

If any exist, they must be refactored to use registry or passed as parameters.

### 9.3 Verify Legacy Mode Still Compiles

The legacy path must still work. All existing Phase 2, 3, 4 imports in engine.ts must be preserved. They are used in the else branch.

---

## Step 10: Clean Up

### 10.1 Remove Unused Imports

After the agentic/legacy split, check if any imports in engine.ts are only used in one branch. If so, use dynamic `import()` for the branch-specific imports to allow tree-shaking.

For legacy-only imports (phase2, phase3, phase4), consider wrapping in the else branch:
```typescript
} else {
  const { phase2Evaluate } = await import('./phases/phase2-evaluate.js')
  const { phase3Execute } = await import('./phases/phase3-execute.js')
  const { phase4Compose } = await import('./phases/phase4-compose.js')
  // ... existing code ...
}
```

However, if this causes readability issues, keep the static imports. Both paths need to compile regardless.

### 10.2 No Orphaned Files

Verify that every new file is imported somewhere:
```bash
# Check that agentic/index.ts is imported
grep -r "agentic/index" src/engine/ || grep -r "agentic'" src/engine/
# Check that prompts/agentic.ts is imported
grep -r "prompts/agentic" src/engine/
```

### 10.3 No Commented-Out Code

Do not leave commented-out code in modified files. If code is deprecated, it stays behind the feature flag, not as comments.

### 10.4 Final Compile

```bash
npx tsc --noEmit
```

Zero errors. Zero warnings from `--noEmit`. If there are warnings, investigate but don't block on them.

---

## Files Created/Modified Summary

### NEW FILES
| File | Purpose |
|---|---|
| `scripts/bump-version.sh` | Version bump with user confirmation |
| `CHANGELOG.md` | v2.0.0 release notes |

### MODIFIED FILES
| File | Change |
|---|---|
| `src/engine/config.ts` | +13 new config keys (engineMode, agentic*, executionQueue*) |
| `src/engine/types.ts` | Re-export agentic types, extend PipelineResult (+2 fields), extend EngineConfig (+13 fields) |
| `src/engine/engine.ts` | Add agentic path in processMessageInner(), new processAgentic() function, new imports |
| `src/engine/phases/phase5-validate.ts` | Make evaluation parameter optional (EvaluatorOutput | null), guard all evaluation.* access |
| `src/engine/proactive/proactive-pipeline.ts` | Add agentic branch, new processProactiveAgentic() function |
| `package.json` | version: "0.1.0" → "2.0.0" |
| `CLAUDE.md` | Add v2.0.0 info, agentic mode docs, version policy |
| `src/engine/CLAUDE.md` | Major rewrite: agentic flow, new files, new config, updated traps |
| `src/modules/tools/CLAUDE.md` | Two-tier descriptions section |
| `src/modules/prompts/CLAUDE.md` | Agentic prompt system section |
| `src/modules/engine/CLAUDE.md` | ENGINE_MODE note |
| `src/engine/checkpoints/CLAUDE.md` | Agentic mode note |
| `deploy/CLAUDE.md` | New env vars note |

### FILES NOT MODIFIED (confirm unchanged)
| File | Reason |
|---|---|
| `src/engine/agentic/*` | Owned by Instance 1 |
| `src/engine/prompts/agentic.ts` | Owned by Instance 2 |
| `src/engine/prompts/context-builder.ts` | Owned by Instance 2 |
| `src/engine/prompts/skills.ts` | Owned by Instance 2 |
| `src/engine/prompts/accent.ts` | Owned by Instance 2 |
| `src/engine/concurrency/execution-queue.ts` | Owned by Instance 3 |
| `src/engine/proactive/smart-cooldown.ts` | Owned by Instance 3 |
| `src/engine/proactive/orphan-recovery.ts` | Owned by Instance 3 |
| `src/engine/proactive/conversation-guard.ts` | Owned by Instance 3 |
| `src/engine/phases/phase1-intake.ts` | No changes needed |
| `src/engine/phases/phase2-evaluate.ts` | Legacy only, no changes |
| `src/engine/phases/phase3-execute.ts` | Legacy only, no changes |
| `src/engine/phases/phase4-compose.ts` | Legacy only, no changes |
| `src/kernel/*` | No changes needed |
| `src/modules/*` (except noted) | No changes needed |
| `src/migrations/*` | No new migrations |

---

## Acceptance Criteria

Before marking this instance as complete, verify ALL of the following:

| # | Criterion | How to verify |
|---|---|---|
| 1 | `npx tsc --noEmit` passes with ZERO errors | Run it |
| 2 | `ENGINE_MODE='agentic'` is the default | Check config.ts: `env('ENGINE_MODE', 'agentic')` |
| 3 | `ENGINE_MODE='legacy'` still works | Check that the else branch in engine.ts contains ALL original Phase 2-5 code unchanged |
| 4 | Phase 5 works with both agentic and legacy output | Check that evaluation parameter is `EvaluatorOutput \| null` and all access is guarded |
| 5 | Proactive pipeline uses agentic loop when agentic mode | Check processProactiveAgentic() exists and is called when engineMode === 'agentic' |
| 6 | Execution queue config keys exist | Check types.ts and config.ts have executionQueue* fields |
| 7 | Version is 2.0.0 in package.json | `node -p "require('./package.json').version"` outputs `2.0.0` |
| 8 | All CLAUDE.md files are updated | Check each file listed in 8.1-8.6 |
| 9 | No orphaned imports or dead code | Check that all imports are used, no commented-out blocks |
| 10 | No circular dependencies | Check that agentic/ does not import functions from engine.ts |
| 11 | No new DB tables | `grep -r "CREATE TABLE" src/` shows no new tables from this instance |
| 12 | Bump script asks for user confirmation | Read scripts/bump-version.sh: has `read -rp` prompt |
| 13 | CHANGELOG.md exists with v2.0.0 entry | Read CHANGELOG.md |
| 14 | Agentic types are re-exported from engine/types.ts | Check the export statement |
| 15 | PipelineResult has agenticResult and effortLevel fields | Check types.ts |

---

## Commit Strategy

Make commits in this order:

1. **`feat(engine): extend config and types for agentic mode`** — Steps 1+2
2. **`feat(engine): wire agentic loop into engine.ts`** — Step 3
3. **`fix(engine): make phase5 evaluation optional for agentic mode`** — Step 4
4. **`feat(engine): wire proactive pipeline to agentic loop`** — Step 5
5. **`chore: add version bump script and set v2.0.0`** — Steps 6+7
6. **`docs: update all CLAUDE.md files for v2.0.0`** — Step 8
7. **`fix(engine): resolve compilation errors and clean up`** — Steps 9+10

Each commit must pass `npx tsc --noEmit` individually.
