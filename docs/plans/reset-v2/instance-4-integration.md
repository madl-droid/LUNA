# Instance 4 -- Integration + Globals + Versioning

> **Branch**: `reset/instance-4-integration` (from `reset`, AFTER instances 1+2+3 merged)
> **LLM**: opus
> **Parallel**: No (sequential -- depends on Instance 1, 2, and 3 being merged to `reset`)
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
- `/docker/luna-repo/src/engine/engine.ts` -- main orchestrator, 5-phase pipeline, concurrency layers
- `/docker/luna-repo/src/engine/types.ts` -- ALL types: ContextBundle, PipelineResult, EngineConfig, etc.
- `/docker/luna-repo/src/engine/config.ts` -- loadEngineConfig(), env/envInt/envBool/envFloat/envProvider helpers

### Files created by Instance 1 (agentic loop)
- `/docker/luna-repo/src/engine/agentic/types.ts` -- AgenticResult, AgenticConfig, EffortLevel, ToolCallLog
- `/docker/luna-repo/src/engine/agentic/loop.ts` -- runAgenticLoop() main entry
- `/docker/luna-repo/src/engine/agentic/effort-router.ts` -- classifyEffort()
- `/docker/luna-repo/src/engine/agentic/dedup.ts` -- tool call deduplication
- `/docker/luna-repo/src/engine/agentic/loop-detector.ts` -- anti-loop with graduated thresholds
- `/docker/luna-repo/src/engine/agentic/post-processor.ts` -- criticizer, formatting, TTS
- `/docker/luna-repo/src/engine/agentic/index.ts` -- public re-exports

### Files created by Instance 2 (prompts)
- `/docker/luna-repo/src/engine/prompts/agentic.ts` -- buildAgenticPrompt()
- `/docker/luna-repo/src/engine/prompts/context-builder.ts` -- context assembly for prompts
- `/docker/luna-repo/src/engine/prompts/skills.ts` -- skill stub system
- `/docker/luna-repo/src/engine/prompts/accent.ts` -- accent injection

### Files created by Instance 3 (proactivity + tools + queue)
- `/docker/luna-repo/src/engine/concurrency/execution-queue.ts` -- ExecutionQueue with lanes
- `/docker/luna-repo/src/engine/proactive/smart-cooldown.ts` -- adaptive next_check_at
- `/docker/luna-repo/src/engine/proactive/orphan-recovery.ts` -- orphan message tracking
- `/docker/luna-repo/src/engine/proactive/conversation-guard.ts` -- enhanced farewell suppression
- `/docker/luna-repo/src/modules/tools/types.ts` -- UPDATED with shortDescription field

### Phase 5 (you will adapt this)
- `/docker/luna-repo/src/engine/phases/phase5-validate.ts` -- validate + send + persist + commitment detect

### Proactive pipeline (you will wire agentic loop here)
- `/docker/luna-repo/src/engine/proactive/proactive-pipeline.ts` -- simplified Phase 1 + Phases 2-5

### Tool system (understand for wiring)
- `/docker/luna-repo/src/modules/tools/tool-registry.ts` -- ToolRegistry: getEnabledToolDefinitions(), executeTool()
- `/docker/luna-repo/src/modules/tools/tool-converter.ts` -- toNativeTools()

### All CLAUDE.md files (you will update these)
- `/docker/luna-repo/CLAUDE.md` -- root project overview
- `/docker/luna-repo/src/engine/CLAUDE.md` -- engine architecture (major update)
- `/docker/luna-repo/src/kernel/CLAUDE.md`
- `/docker/luna-repo/src/modules/CLAUDE.md`
- `/docker/luna-repo/src/modules/engine/CLAUDE.md`
- `/docker/luna-repo/src/modules/tools/CLAUDE.md`
- `/docker/luna-repo/src/modules/prompts/CLAUDE.md`
- `/docker/luna-repo/src/engine/checkpoints/CLAUDE.md`
- `/docker/luna-repo/deploy/CLAUDE.md`

### package.json (version bump)
- `/docker/luna-repo/package.json` -- currently version "0.1.0", will become "2.0.0"

---

## Critical Rules

### REUSE EVERYTHING
Before creating any function, hook, service, type, or file -- check `reuse-inventory.md`. If it exists, use it. Do not duplicate.

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
# Confirm instances 1, 2, 3 are merged:
git log --oneline -20
# Verify key files exist:
ls src/engine/agentic/loop.ts
ls src/engine/prompts/agentic.ts
ls src/engine/concurrency/execution-queue.ts
ls src/engine/proactive/smart-cooldown.ts
# Create branch:
git checkout -b reset/instance-4-integration
```

### 0.2 Read ALL New Files from Instances 1, 2, 3

Read every file listed in the "Files created by Instance 1/2/3" sections above. Do not skim -- read them in full. You need to understand:

- The exact signature of `runAgenticLoop()` and what it returns (`AgenticResult`)
- The exact signature of `buildAgenticPrompt()` and what parameters it needs
- The exact signature of `classifyEffort()` and what it returns (`EffortLevel`)
- The exact signature of `postProcess()` and what it returns
- How `ExecutionQueue` works -- its `enqueue()` method, lane types, priority
- How `smartCooldown()` computes the next check time
- How `orphanRecovery` and `conversationGuard` are used
- The `AgenticConfig` interface -- all fields and their defaults
- The `ToolCallLog` type -- what fields it has
- The `shortDescription` field on tool definitions

### 0.3 Read Engine Core Files

Read in full:
- `src/engine/engine.ts` -- understand `processMessageInner()`, the ACK system, contact lock, semaphore, checkpoint logic, replanning loop
- `src/engine/types.ts` -- understand every exported type
- `src/engine/config.ts` -- understand `loadEngineConfig()` and how env vars are read
- `src/engine/phases/phase5-validate.ts` -- understand its parameters, what it does with `evaluation` and `execution`
- `src/engine/proactive/proactive-pipeline.ts` -- understand how it calls Phases 2-5

### 0.4 Verify Understanding

Before writing code, verify you can answer:
1. What does `processMessageInner()` return? What type?
2. How does the ACK (aviso) system work? Where does it wrap the pipeline?
3. How does the contact lock prevent concurrent processing of the same contact?
4. What does Phase 5 do with `evaluation.plan`? With `execution.steps`?
5. How does the proactive pipeline differ from the reactive pipeline?
6. What does `AgenticResult.textResponse` contain?
7. What does `AgenticResult.toolCallsLog` contain?
8. How does `buildAgenticPrompt()` get conversation history?

---

## Step 1: Extend src/engine/types.ts

**Goal**: Add agentic types to the central types file without breaking any existing imports.

### 1.1 Re-export Agentic Types

At the TOP of `src/engine/types.ts`, add re-exports from the agentic module. This makes agentic types available to any file that already imports from `./types.js`:

```typescript
// --- Agentic types (v2.0) ---
export type {
  AgenticResult,
  AgenticConfig,
  EffortLevel,
  ToolCallLog,
} from './agentic/types.js';
```

### 1.2 Extend PipelineResult

Find the existing `PipelineResult` interface. Add these OPTIONAL fields (so legacy code that does not set them continues to compile):

```typescript
// Inside existing PipelineResult interface, add:
  agenticResult?: AgenticResult;
  effortLevel?: EffortLevel;
  engineMode: 'agentic' | 'legacy';
```

IMPORTANT: `engineMode` is required (not optional) because EVERY pipeline run must declare its mode. This means you need to update every place that constructs a `PipelineResult` to include `engineMode`. Search for all places that create a `PipelineResult` object:
- In `engine.ts` (the main return)
- In `proactive-pipeline.ts` (if it constructs one)
- Any other file

For legacy code paths, set `engineMode: 'legacy'`. For the new agentic path, set `engineMode: 'agentic'`.

If there are too many construction sites and adding a required field would be disruptive, make it optional with a fallback:
```typescript
  engineMode?: 'agentic' | 'legacy';
```
Then wherever you READ it, default to `'legacy'`: `const mode = result.engineMode ?? 'legacy'`.

### 1.3 Add AgenticPipelineOptions

Add a new interface (does not extend anything existing):

```typescript
export interface AgenticPipelineOptions {
  engineMode?: 'agentic' | 'legacy';
  forceEffort?: EffortLevel;
  isProactive?: boolean;
}
```

### 1.4 Verify

- All existing imports from `./types.js` still work (no removed exports)
- New types are available via `import type { AgenticResult } from './types.js'`
- `npx tsc --noEmit` passes

### 1.5 Commit

```
feat(types): add agentic types to engine type system

Re-export AgenticResult, AgenticConfig, EffortLevel, ToolCallLog from
agentic/types. Extend PipelineResult with agenticResult, effortLevel,
engineMode. Add AgenticPipelineOptions interface.
```

---

## Step 2: Extend src/engine/config.ts

**Goal**: Add new config keys for the agentic engine without breaking existing config.

### 2.1 Extend the EngineConfig Interface

Find the `EngineConfig` interface in `config.ts` (or in `types.ts` if defined there -- check both). Add these fields:

```typescript
// --- Agentic engine config (v2.0) ---
engineMode: 'agentic' | 'legacy';
agenticMaxTurns: number;
effortRoutingEnabled: boolean;
toolDedupEnabled: boolean;
loopDetectionEnabled: boolean;
errorAsContextEnabled: boolean;
partialRecoveryEnabled: boolean;
lowEffortModel: string;
lowEffortProvider: string;
mediumEffortModel: string;
mediumEffortProvider: string;
highEffortModel: string;
highEffortProvider: string;
```

### 2.2 Update loadEngineConfig()

In the `loadEngineConfig()` function, add reads for the new env vars. Use the existing helper pattern (env, envInt, envBool, etc.):

```typescript
// --- Agentic engine config (v2.0) ---
engineMode:             (env('ENGINE_MODE') ?? 'agentic') as 'agentic' | 'legacy',
agenticMaxTurns:        envInt('ENGINE_AGENTIC_MAX_TURNS', 15),
effortRoutingEnabled:   envBool('ENGINE_EFFORT_ROUTING', true),
toolDedupEnabled:       envBool('ENGINE_TOOL_DEDUP', true),
loopDetectionEnabled:   envBool('ENGINE_LOOP_DETECTION', true),
errorAsContextEnabled:  envBool('ENGINE_ERROR_AS_CONTEXT', true),
partialRecoveryEnabled: envBool('ENGINE_PARTIAL_RECOVERY', true),
lowEffortModel:         env('LLM_LOW_EFFORT_MODEL') ?? 'claude-haiku-4-5-20251001',
lowEffortProvider:      env('LLM_LOW_EFFORT_PROVIDER') ?? 'anthropic',
mediumEffortModel:      env('LLM_MEDIUM_EFFORT_MODEL') ?? 'claude-sonnet-4-6',
mediumEffortProvider:   env('LLM_MEDIUM_EFFORT_PROVIDER') ?? 'anthropic',
highEffortModel:        env('LLM_HIGH_EFFORT_MODEL') ?? 'claude-sonnet-4-6',
highEffortProvider:     env('LLM_HIGH_EFFORT_PROVIDER') ?? 'anthropic',
```

NOTE: Check the exact helper function names in config.ts. They might be `env()`, `envInt()`, `envBool()`, `envFloat()`, or `envProvider()`. Use whichever already exists. If `envBool` does not exist, implement the parsing inline: `(env('ENGINE_EFFORT_ROUTING') ?? 'true') === 'true'`.

### 2.3 Verify

- `loadEngineConfig()` returns an object that satisfies the extended `EngineConfig` type
- Default values are sensible (agentic mode on, all features enabled, Sonnet for medium/high, Haiku for low)
- `npx tsc --noEmit` passes

### 2.4 Commit

```
feat(config): add agentic engine configuration keys

Add ENGINE_MODE, ENGINE_AGENTIC_MAX_TURNS, ENGINE_EFFORT_ROUTING,
ENGINE_TOOL_DEDUP, ENGINE_LOOP_DETECTION, ENGINE_ERROR_AS_CONTEXT,
ENGINE_PARTIAL_RECOVERY, and per-effort-level LLM model/provider
config keys. Default: agentic mode with all features enabled.
```

---

## Step 3: Modify src/engine/engine.ts -- MAIN WIRING

**This is the most critical step.** The engine.ts file is the heart of the system. Every change must be surgical and reversible.

### 3.1 Add Imports

At the top of `engine.ts`, add imports for the new modules. Place them after existing imports, grouped logically:

```typescript
// --- Agentic imports (v2.0) ---
import { classifyEffort, runAgenticLoop, postProcess } from './agentic/index.js';
import { buildAgenticPrompt } from './prompts/agentic.js';
import type { AgenticConfig, AgenticResult, EffortLevel } from './agentic/types.js';
```

If the ExecutionQueue is used here (depends on Instance 3 design):
```typescript
import { ExecutionQueue } from './concurrency/execution-queue.js';
```

### 3.2 Initialize ExecutionQueue (if applicable)

Check if `ExecutionQueue` is a singleton or needs initialization. If it needs to be created:

```typescript
// Near the top of the module, after imports
const executionQueue = new ExecutionQueue({
  maxConcurrentReactive: 5,   // or read from config
  maxConcurrentProactive: 2,
  maxConcurrentBackground: 1,
});
```

If `ExecutionQueue` is already initialized elsewhere (e.g., in Instance 3's code), just import and use it.

### 3.3 Modify processMessageInner()

This is the core change. Find the `processMessageInner()` function. It currently has a flow like:

```
Phase 1 (understand) -> Phase 2 (evaluate) -> Phase 3 (execute) -> Phase 4 (compose) -> Phase 5 (validate)
```

You need to insert a branch after Phase 1:

```typescript
// After Phase 1 completes (ctx is now populated with understanding):

if (config.engineMode === 'agentic') {
  // --- AGENTIC PIPELINE ---
  return await runAgenticPipeline(ctx, config, registry);
}

// --- LEGACY PIPELINE (unchanged) ---
// ... existing Phase 2 -> 3 -> 4 -> 5 code stays here ...
```

### 3.4 Implement runAgenticPipeline() Helper

Create a new private function in `engine.ts` (NOT a separate file -- keep it in engine.ts for now to avoid circular deps):

```typescript
async function runAgenticPipeline(
  ctx: ContextBundle,
  config: EngineConfig,
  registry: ModuleRegistry,
): Promise<PipelineResult> {
  const log = ctx.log.child({ pipeline: 'agentic' });

  // 3.4.1 - Classify effort level
  const effortLevel: EffortLevel = config.effortRoutingEnabled
    ? await classifyEffort(ctx, config)
    : 'medium';
  log.info({ effortLevel }, 'effort classified');

  // 3.4.2 - Select model based on effort
  const modelConfig = getModelForEffort(effortLevel, config);

  // 3.4.3 - Get tool definitions from registry
  const toolRegistry = registry.getService<ToolRegistry>('tools', 'toolRegistry');
  const toolDefs = toolRegistry.getEnabledToolDefinitions(ctx.userType);
  const nativeTools = toNativeTools(toolDefs, modelConfig.provider);

  // 3.4.4 - Build system prompt
  const systemPrompt = await buildAgenticPrompt(ctx, toolDefs, registry, {
    isProactive: false,
    effortLevel,
  });

  // 3.4.5 - Build agentic config
  const agenticConfig: AgenticConfig = {
    maxTurns: config.agenticMaxTurns,
    model: modelConfig.model,
    provider: modelConfig.provider,
    dedupEnabled: config.toolDedupEnabled,
    loopDetectionEnabled: config.loopDetectionEnabled,
    errorAsContext: config.errorAsContextEnabled,
    partialRecovery: config.partialRecoveryEnabled,
  };

  // 3.4.6 - Run the agentic loop
  const agenticResult: AgenticResult = await runAgenticLoop(
    ctx,
    systemPrompt,
    nativeTools,
    agenticConfig,
    registry,
  );
  log.info({
    turns: agenticResult.turnsUsed,
    toolCalls: agenticResult.toolCallsLog.length,
    stopReason: agenticResult.stopReason,
  }, 'agentic loop complete');

  // 3.4.7 - Post-process (criticizer, formatting, TTS)
  const compositorOutput = await postProcess(agenticResult, ctx, config, registry);

  // 3.4.8 - Phase 5: validate, send, persist
  // Phase 5 is reused -- it handles sending the message, persisting, commitment detection.
  // In agentic mode, evaluation and execution are not available, so pass undefined.
  const phase5Result = await phase5Validate(ctx, {
    composition: compositorOutput,
    evaluation: undefined,
    execution: undefined,
    agenticResult,
    engineMode: 'agentic',
  });

  // 3.4.9 - Build pipeline result
  return {
    ...phase5Result,
    agenticResult,
    effortLevel,
    engineMode: 'agentic',
  };
}
```

### 3.5 Implement getModelForEffort() Helper

```typescript
function getModelForEffort(effort: EffortLevel, config: EngineConfig): { model: string; provider: string } {
  switch (effort) {
    case 'low':
      return { model: config.lowEffortModel, provider: config.lowEffortProvider };
    case 'medium':
      return { model: config.mediumEffortModel, provider: config.mediumEffortProvider };
    case 'high':
      return { model: config.highEffortModel, provider: config.highEffortProvider };
    default:
      return { model: config.mediumEffortModel, provider: config.mediumEffortProvider };
  }
}
```

### 3.6 Keep Legacy Path Intact

The existing Phase 2 -> 3 -> 4 -> 5 code MUST remain unchanged. It runs when `config.engineMode === 'legacy'`. Add `engineMode: 'legacy'` to the PipelineResult it returns.

Search for every place the legacy path constructs its final return value and add:
```typescript
engineMode: 'legacy',
```

### 3.7 ACK System -- No Changes Needed

The ACK (aviso) system wraps the ENTIRE pipeline call. It does not care whether the inner pipeline is agentic or legacy. Verify this by reading the ACK wrapper code. It should call `processMessageInner()` and handle the result uniformly.

If the ACK system references `evaluation` or `execution` fields from the result, add fallbacks:
```typescript
const evaluation = result.evaluation ?? null;
const execution = result.execution ?? null;
```

### 3.8 Contact Lock -- No Changes Needed

The contact lock prevents concurrent processing for the same contact. It wraps `processMessageInner()` and is mode-agnostic. Verify it does not reference legacy-specific types.

### 3.9 Integrate with ExecutionQueue

If the current engine uses a semaphore or concurrency limiter, replace it with (or wrap it in) the ExecutionQueue from Instance 3:

```typescript
// Before (current semaphore):
await semaphore.acquire();
try {
  result = await processMessageInner(ctx, config, registry);
} finally {
  semaphore.release();
}

// After (ExecutionQueue):
result = await executionQueue.enqueue('reactive', async () => {
  return await processMessageInner(ctx, config, registry);
});
```

If the current engine does NOT have a semaphore, add the ExecutionQueue call at the appropriate concurrency boundary.

IMPORTANT: Only do this if it fits cleanly. If the ExecutionQueue integration is complex, defer it to a follow-up and leave a TODO comment.

### 3.10 Replanning Loop

The current engine has a replanning loop (re-run Phase 2-4 if Phase 5 detects issues). In agentic mode, this is NOT needed because:
- The agentic loop handles retries natively (tool errors are fed back to the LLM)
- The post-processor handles quality checks

In the `if (config.engineMode === 'agentic')` branch, skip the replanning loop entirely.

### 3.11 Checkpoint System

The current engine may have a checkpoint system for resumable pipelines. In agentic mode:
- If checkpoints are phase-based (checkpoint after each phase), they do not apply to agentic mode
- If checkpoints are generic (save/resume any async work), they can stay
- Simplest approach: in agentic mode, skip checkpoint save/restore. The agentic loop is designed to complete in one pass.

Add a guard:
```typescript
if (config.engineMode === 'legacy') {
  await saveCheckpoint(ctx, phase, result);
}
```

### 3.12 Verify

- `processMessageInner()` branches correctly based on `config.engineMode`
- Legacy path is completely unchanged
- Agentic path calls: classifyEffort -> buildAgenticPrompt -> runAgenticLoop -> postProcess -> phase5Validate
- ACK system works with both modes
- Contact lock works with both modes
- No circular imports (engine.ts imports from agentic/, not the reverse)
- `npx tsc --noEmit` passes

### 3.13 Commit

```
feat(engine): wire agentic loop as default pipeline

When ENGINE_MODE=agentic (default), the engine now runs:
Phase 1 -> effort classification -> agentic loop -> post-process -> Phase 5.
Legacy pipeline (Phase 1-5) preserved behind ENGINE_MODE=legacy flag.
ACK system and contact lock remain mode-agnostic.
```

---

## Step 4: Modify src/engine/phases/phase5-validate.ts

**Goal**: Make Phase 5 work with both agentic and legacy outputs.

### 4.1 Read Phase 5 Carefully

Understand every parameter Phase 5 receives and how it uses them. Key questions:
- Does it read `evaluation.plan` to log the plan? -> In agentic mode, there is no plan. Use agenticResult metadata instead.
- Does it read `execution.steps` to log tool calls? -> In agentic mode, use agenticResult.toolCallsLog instead.
- Does it read `execution.finalResponse`? -> In agentic mode, the response comes from compositorOutput.
- Does it use `evaluation` or `execution` for commitment detection? -> Check. If yes, provide fallback data.

### 4.2 Make Parameters Optional

Change the function signature. The EXACT change depends on the current signature, but the pattern is:

```typescript
// Before:
export async function phase5Validate(
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  execution: ExecutionOutput,
  composition: CompositorOutput,
): Promise<Phase5Result>

// After:
export async function phase5Validate(
  ctx: ContextBundle,
  params: {
    composition: CompositorOutput;
    evaluation?: EvaluatorOutput;
    execution?: ExecutionOutput;
    agenticResult?: AgenticResult;
    engineMode?: 'agentic' | 'legacy';
  },
): Promise<Phase5Result>
```

ALTERNATIVE: If changing the signature would break too many callers, use an overload or a wrapper:

```typescript
// Keep original signature for legacy callers:
export async function phase5Validate(
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  execution: ExecutionOutput,
  composition: CompositorOutput,
): Promise<Phase5Result>;

// Add overload for agentic callers:
export async function phase5Validate(
  ctx: ContextBundle,
  params: Phase5Params,
): Promise<Phase5Result>;

// Implementation:
export async function phase5Validate(
  ctx: ContextBundle,
  evalOrParams: EvaluatorOutput | Phase5Params,
  execution?: ExecutionOutput,
  composition?: CompositorOutput,
): Promise<Phase5Result> {
  // Detect which overload was called
  const params: Phase5Params = 'composition' in evalOrParams
    ? evalOrParams
    : { evaluation: evalOrParams, execution: execution!, composition: composition! };
  // ... rest of function uses params.evaluation, params.execution, params.composition
}
```

Choose whichever approach is LESS disruptive to existing code. The overload approach is safer because it does not require changing any existing callers.

### 4.3 Adapt Internal Logic

Inside Phase 5, wherever `evaluation` or `execution` is used:

```typescript
// For logging the plan:
const plan = params.evaluation?.plan
  ?? params.agenticResult?.toolCallsLog.map(t => t.toolName).join(', ')
  ?? 'no plan';

// For logging tool call count:
const toolCallCount = params.execution?.steps?.length
  ?? params.agenticResult?.toolCallsLog.length
  ?? 0;

// For the pipeline_logs insert:
const logEntry = {
  ...existingLogFields,
  engine_mode: params.engineMode ?? 'legacy',
  effort_level: params.agenticResult?.effortLevel ?? null,
  agentic_turns: params.agenticResult?.turnsUsed ?? null,
  agentic_stop_reason: params.agenticResult?.stopReason ?? null,
};
```

### 4.4 pipeline_logs Schema Compatibility

The `pipeline_logs` table may not have columns for `engine_mode`, `effort_level`, etc. Two options:

1. **Use the existing `metadata` JSONB column** (if one exists) to store agentic-specific data. This avoids a migration.
2. **If there is no JSONB column**, store agentic metadata in an existing text/json column, or skip it and log to pino instead.

Do NOT create a new migration. Use existing columns or structured logging.

### 4.5 Update All Callers of Phase 5

Search for every file that calls `phase5Validate`:
```bash
grep -rn 'phase5Validate\|phase5_validate\|phase5' src/engine/ --include='*.ts'
```

For each caller:
- If it is the legacy path in engine.ts: keep the existing call (if using overloads, it still works)
- If it is the proactive pipeline: update in Step 5
- If it is any other file: update to match the new signature

### 4.6 Verify

- Phase 5 works when called with full legacy params (evaluation + execution + composition)
- Phase 5 works when called with agentic params (composition + agenticResult, no evaluation/execution)
- Commitment detection works in both modes
- Message sending works in both modes
- Persistence works in both modes
- `npx tsc --noEmit` passes

### 4.7 Commit

```
feat(phase5): accept both agentic and legacy pipeline outputs

Make evaluation and execution parameters optional in phase5Validate.
When in agentic mode, use AgenticResult metadata for logging and
tool call tracking. Commitment detection and message sending are
mode-agnostic.
```

---

## Step 5: Modify src/engine/proactive/proactive-pipeline.ts

**Goal**: Make the proactive pipeline use the agentic loop when ENGINE_MODE=agentic.

### 5.1 Read Current Proactive Pipeline

Understand:
- How it calls Phases 2-5
- How it differs from the reactive pipeline (lower priority, different prompt context, different model selection)
- How it handles cooldowns and rate limiting
- How it constructs the ContextBundle

### 5.2 Add Agentic Branch

Similar to engine.ts, add a branch after context construction:

```typescript
// After ContextBundle is ready:

if (config.engineMode === 'agentic') {
  return await runProactiveAgentic(ctx, config, registry);
}

// Legacy path unchanged...
```

### 5.3 Implement runProactiveAgentic()

```typescript
async function runProactiveAgentic(
  ctx: ContextBundle,
  config: EngineConfig,
  registry: ModuleRegistry,
): Promise<ProactivePipelineResult> {
  const log = ctx.log.child({ pipeline: 'proactive-agentic' });

  // Proactive messages use lower effort (fewer turns, smaller model)
  const effortLevel: EffortLevel = 'low';
  const modelConfig = {
    model: config.lowEffortModel,
    provider: config.lowEffortProvider,
  };

  // Get tools -- proactive may have a restricted tool set
  const toolRegistry = registry.getService<ToolRegistry>('tools', 'toolRegistry');
  const toolDefs = toolRegistry.getEnabledToolDefinitions(ctx.userType);
  const nativeTools = toNativeTools(toolDefs, modelConfig.provider);

  // Build prompt with proactive context
  const systemPrompt = await buildAgenticPrompt(ctx, toolDefs, registry, {
    isProactive: true,
    effortLevel,
  });

  // Agentic config -- lower limits for proactive
  const agenticConfig: AgenticConfig = {
    maxTurns: Math.min(config.agenticMaxTurns, 5), // Cap proactive at 5 turns
    model: modelConfig.model,
    provider: modelConfig.provider,
    dedupEnabled: config.toolDedupEnabled,
    loopDetectionEnabled: config.loopDetectionEnabled,
    errorAsContext: config.errorAsContextEnabled,
    partialRecovery: config.partialRecoveryEnabled,
  };

  // Run agentic loop
  const agenticResult = await runAgenticLoop(
    ctx, systemPrompt, nativeTools, agenticConfig, registry,
  );
  log.info({
    turns: agenticResult.turnsUsed,
    stopReason: agenticResult.stopReason,
  }, 'proactive agentic loop complete');

  // Post-process
  const compositorOutput = await postProcess(agenticResult, ctx, config, registry);

  // Phase 5
  const phase5Result = await phase5Validate(ctx, {
    composition: compositorOutput,
    agenticResult,
    engineMode: 'agentic',
  });

  return {
    ...phase5Result,
    agenticResult,
    effortLevel,
    engineMode: 'agentic',
  };
}
```

### 5.4 Integrate Smart Cooldown

After the proactive pipeline runs (whether agentic or legacy), integrate the smart cooldown from Instance 3:

```typescript
import { computeSmartCooldown } from './smart-cooldown.js';

// After pipeline completes:
const nextCheckAt = computeSmartCooldown(ctx, result);
// Store nextCheckAt in the session or proactive_outreach_log
```

### 5.5 Integrate Orphan Recovery

If orphan recovery runs as part of the proactive pipeline:
```typescript
import { checkOrphans } from './orphan-recovery.js';

// Before running proactive pipeline for a contact:
const orphanMessages = await checkOrphans(ctx);
if (orphanMessages.length > 0) {
  // Add orphan context to the prompt or handle separately
}
```

### 5.6 Integrate Conversation Guard

```typescript
import { shouldSuppressFarewell } from './conversation-guard.js';

// Before sending a proactive message:
if (await shouldSuppressFarewell(ctx, compositorOutput.text)) {
  log.info('farewell suppressed by conversation guard');
  return { suppressed: true, reason: 'farewell_guard' };
}
```

### 5.7 Integrate with ExecutionQueue

Proactive messages should go through the 'proactive' lane:

```typescript
const result = await executionQueue.enqueue('proactive', async () => {
  return await runProactiveInner(ctx, config, registry);
});
```

### 5.8 Verify

- Proactive pipeline uses agentic loop when ENGINE_MODE=agentic
- Proactive pipeline uses legacy Phases 2-5 when ENGINE_MODE=legacy
- Smart cooldown is called after pipeline completion
- Orphan recovery is checked before proactive runs
- Conversation guard prevents inappropriate farewell messages
- ExecutionQueue 'proactive' lane is used
- `npx tsc --noEmit` passes

### 5.9 Commit

```
feat(proactive): wire agentic loop into proactive pipeline

Proactive pipeline now uses agentic loop in agentic mode with lower
effort (5 max turns, low-effort model). Integrates smart cooldown,
orphan recovery, and conversation guard from Instance 3.
```

---

## Step 6: Update ALL CLAUDE.md Files

**Goal**: Every CLAUDE.md accurately describes the v2.0 architecture.

### 6.1 /docker/luna-repo/CLAUDE.md (Root)

Major updates:
- Change "Pipeline de 5 pasos" to describe the dual-mode architecture
- Add mention of agentic loop as default mode
- Add new directory entries for `src/engine/agentic/`, `src/engine/concurrency/`
- Update the Estructura de directorios section
- Add ENV vars section mentioning ENGINE_MODE
- Keep ALL existing content that is still accurate

Specific changes:
```
# In the Architecture section:
- Pipeline de procesamiento: agentic loop (default) o legacy 5-phase (fallback)
- ENGINE_MODE=agentic: Phase 1 -> agentic loop -> post-process -> Phase 5
- ENGINE_MODE=legacy: Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5

# In the directory structure, add:
  engine/
    agentic/         -- agentic loop, effort router, dedup, loop detector, post-processor
    concurrency/     -- execution queue with priority lanes
    prompts/         -- prompt builders (agentic.ts, context-builder.ts, skills.ts, accent.ts)
```

### 6.2 /docker/luna-repo/src/engine/CLAUDE.md (MAJOR UPDATE)

This file needs the most extensive update. It should describe:

1. **Dual-mode architecture**: agentic (default) vs legacy
2. **Agentic pipeline flow**: Phase 1 -> classify effort -> build prompt -> agentic loop -> post-process -> Phase 5
3. **Legacy pipeline flow**: Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 (deprecated, fallback only)
4. **New directories**: agentic/, concurrency/, prompts/ updates
5. **Config keys**: ENGINE_MODE, ENGINE_AGENTIC_MAX_TURNS, etc.
6. **Effort routing**: low/medium/high -> different models
7. **Tool dedup**: prevents duplicate tool calls in same turn
8. **Loop detection**: graduated thresholds to prevent infinite loops
9. **Post-processor**: criticizer, formatting, TTS
10. **ExecutionQueue**: reactive > proactive > background priority
11. **Smart cooldown**: adaptive proactive timing
12. **Deprecation notice**: Phases 2, 3, 4 are deprecated (legacy fallback only)

Keep the file under 120 lines. Focus on architecture, not implementation details.

### 6.3 Other CLAUDE.md Files

For each of these, read the current content and make ONLY the changes needed:

- `/docker/luna-repo/src/kernel/CLAUDE.md` -- Update if it references the engine pipeline. Mention that engine now has dual-mode architecture.
- `/docker/luna-repo/src/modules/CLAUDE.md` -- Probably no changes needed unless it references the pipeline.
- `/docker/luna-repo/src/modules/engine/CLAUDE.md` -- Update: the engine module wrapper now supports agentic mode. Mention ENGINE_MODE config.
- `/docker/luna-repo/src/modules/tools/CLAUDE.md` -- Update: mention shortDescription field, two-tier tool descriptions for agentic mode.
- `/docker/luna-repo/src/modules/prompts/CLAUDE.md` -- Update: mention new prompt files (agentic.ts, context-builder.ts, skills.ts, accent.ts).
- `/docker/luna-repo/src/engine/checkpoints/CLAUDE.md` -- Update: checkpoints are legacy-mode only when ENGINE_MODE=agentic.
- `/docker/luna-repo/deploy/CLAUDE.md` -- Update: add ENGINE_MODE to the environment variables section.

### 6.4 Verify

- Every CLAUDE.md accurately describes the current state
- No CLAUDE.md references features that do not exist
- No CLAUDE.md omits major new features
- File paths in CLAUDE.md files are correct

### 6.5 Commit

```
docs: update all CLAUDE.md files for v2.0 agentic architecture

Major update to src/engine/CLAUDE.md reflecting dual-mode architecture.
Root CLAUDE.md updated with new directory structure. Module CLAUDE.md
files updated with relevant v2.0 changes.
```

---

## Step 7: Version Bump and Policy

### 7.1 Update package.json

Change the version field:
```json
"version": "2.0.0"
```

### 7.2 Create scripts/version-bump.js

Create a simple version bump script:

```javascript
#!/usr/bin/env node

/**
 * Version bump script for Luna.
 * Usage: npm run version:bump -- [major|minor|patch]
 * Example: npm run version:bump -- patch  -> 2.0.0 -> 2.0.1
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');

const bumpType = process.argv[2];
if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Usage: npm run version:bump -- [major|minor|patch]');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

console.log(`Bumping version: ${pkg.version} -> ${newVersion} (${bumpType})`);
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated ${pkgPath}`);
```

### 7.3 Add Script to package.json

In the `scripts` section of package.json:
```json
"version:bump": "node scripts/version-bump.js"
```

### 7.4 Verify

```bash
node scripts/version-bump.js patch  # Should print: 2.0.0 -> 2.0.1
# Revert: manually set back to 2.0.0
```

### 7.5 Commit

```
chore: bump version to 2.0.0, add version bump script

Set package.json version to 2.0.0 for agentic engine release.
Add scripts/version-bump.js for major/minor/patch bumps.
```

---

## Step 8: Final Compilation Check

### 8.1 Run TypeScript Compiler

```bash
cd /docker/luna-repo
npx tsc --noEmit
```

### 8.2 Fix ALL Errors

Common errors to expect:
- **Missing .js extensions**: ESM requires `.js` in relative imports. Fix: add `.js` to any new import paths.
- **Type mismatches**: New optional fields on PipelineResult may cause issues where code expects required fields. Fix: add `?` or provide defaults.
- **Circular imports**: engine.ts imports from agentic/, which might import from engine types. Fix: ensure agentic/ only imports types (not runtime code) from engine.
- **Unused imports**: Remove any imports that are not used.
- **noUncheckedIndexedAccess**: Array access without `?.` or `!`. Fix: add appropriate access guards.

### 8.3 Check for Circular Imports

```bash
# Rough check -- look for cycles between engine.ts and agentic/
grep -rn "from.*engine\.js\|from.*engine/engine" src/engine/agentic/ --include='*.ts'
# Should return nothing (agentic should NOT import from engine.ts)
```

If circular imports exist, break them by:
1. Moving shared types to `types.ts` (which both can import)
2. Using dependency injection (pass functions as parameters instead of importing them)

### 8.4 Check ESM Import Extensions

```bash
# Find imports missing .js extension
grep -rn "from '\.\./\|from '\.\/" src/engine/ --include='*.ts' | grep -v "\.js'" | grep -v "\.json'"
# Every relative import should end with .js
```

Fix any missing extensions.

### 8.5 Verify Legacy Mode

Mentally trace through the legacy path:
1. ENGINE_MODE=legacy
2. processMessageInner() skips agentic branch
3. Phase 2 -> 3 -> 4 -> 5 runs as before
4. PipelineResult includes `engineMode: 'legacy'`
5. No agentic-specific code is executed

### 8.6 Commit (if fixes were needed)

```
fix: resolve compilation errors in agentic integration

Fix [describe specific fixes: missing .js extensions, type mismatches, etc.]
```

---

## Step 9: Deprecation Markers

### 9.1 Add @deprecated JSDoc Comments

Add deprecation notices to legacy phase files. Do NOT modify any logic -- only add JSDoc comments.

**src/engine/phases/phase2-evaluate.ts**:
```typescript
/**
 * Phase 2: Evaluate -- plan generation via LLM.
 *
 * @deprecated Use agentic loop (ENGINE_MODE=agentic). This phase is kept
 * for legacy fallback only (ENGINE_MODE=legacy). Will be removed in v3.0.
 */
```

**src/engine/phases/phase3-execute.ts**:
```typescript
/**
 * Phase 3: Execute -- run tools based on evaluation plan.
 *
 * @deprecated Use agentic loop (ENGINE_MODE=agentic). This phase is kept
 * for legacy fallback only (ENGINE_MODE=legacy). Will be removed in v3.0.
 */
```

**src/engine/phases/phase4-compose.ts**:
```typescript
/**
 * Phase 4: Compose -- generate final response via LLM.
 *
 * @deprecated Use agentic loop (ENGINE_MODE=agentic). This phase is kept
 * for legacy fallback only (ENGINE_MODE=legacy). Will be removed in v3.0.
 */
```

**src/engine/prompts/evaluator.ts**:
```typescript
/**
 * Evaluator prompt builder -- generates the system prompt for Phase 2.
 *
 * @deprecated Use buildAgenticPrompt() from ./agentic.ts. This prompt builder
 * is kept for legacy fallback only (ENGINE_MODE=legacy). Will be removed in v3.0.
 */
```

### 9.2 Verify

- Deprecation comments are JSDoc (not inline comments)
- No logic was changed
- `npx tsc --noEmit` still passes

### 9.3 Commit

```
chore: add @deprecated markers to legacy pipeline phases

Mark phase2-evaluate, phase3-execute, phase4-compose, and
prompts/evaluator as deprecated in favor of the agentic loop.
Kept for ENGINE_MODE=legacy fallback. Planned removal in v3.0.
```

---

## Files Modified Summary

### MODIFIED:
| File | Change |
|------|--------|
| `src/engine/types.ts` | Re-export agentic types, extend PipelineResult, add AgenticPipelineOptions |
| `src/engine/config.ts` | Add ENGINE_MODE, agentic max turns, effort routing, model config keys |
| `src/engine/engine.ts` | **Main wiring** -- branch agentic vs legacy after Phase 1, implement runAgenticPipeline() |
| `src/engine/phases/phase5-validate.ts` | Make evaluation/execution optional, accept AgenticResult |
| `src/engine/proactive/proactive-pipeline.ts` | Add agentic branch, integrate smart cooldown/orphan/guard/queue |
| `src/engine/phases/phase2-evaluate.ts` | @deprecated JSDoc comment only |
| `src/engine/phases/phase3-execute.ts` | @deprecated JSDoc comment only |
| `src/engine/phases/phase4-compose.ts` | @deprecated JSDoc comment only |
| `src/engine/prompts/evaluator.ts` | @deprecated JSDoc comment only |
| `package.json` | Version 2.0.0, add version:bump script |
| `CLAUDE.md` (root) | Update architecture, directory structure |
| `src/engine/CLAUDE.md` | Major rewrite for dual-mode architecture |
| `src/kernel/CLAUDE.md` | Minor update referencing engine dual-mode |
| `src/modules/engine/CLAUDE.md` | Mention ENGINE_MODE support |
| `src/modules/tools/CLAUDE.md` | Mention shortDescription, two-tier tool descriptions |
| `src/modules/prompts/CLAUDE.md` | Mention new prompt files |
| `src/engine/checkpoints/CLAUDE.md` | Note checkpoints are legacy-only in agentic mode |
| `deploy/CLAUDE.md` | Add ENGINE_MODE to env vars |

### NEW:
| File | Purpose |
|------|---------|
| `scripts/version-bump.js` | Simple major/minor/patch version bump utility |

---

## Acceptance Criteria Checklist

Before opening the PR, verify EVERY item:

1. [ ] `npx tsc --noEmit` passes with ZERO errors
2. [ ] ENGINE_MODE=agentic uses: Phase 1 -> effort classification -> agentic loop -> post-process -> Phase 5
3. [ ] ENGINE_MODE=legacy uses: Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 (completely unchanged)
4. [ ] Phase 5 works with both agentic output (no evaluation/execution) and legacy output (full params)
5. [ ] Proactive pipeline uses agentic loop when ENGINE_MODE=agentic
6. [ ] ExecutionQueue prioritizes reactive > proactive > background
7. [ ] All CLAUDE.md files updated and accurate
8. [ ] package.json version is "2.0.0"
9. [ ] Version bump script works: `node scripts/version-bump.js patch`
10. [ ] No circular imports between engine.ts and agentic/
11. [ ] All .js extensions present in ESM relative imports
12. [ ] Legacy phases (2, 3, 4) have @deprecated JSDoc markers
13. [ ] No existing tests broken (if there are tests, run them)
14. [ ] ACK system works in both modes
15. [ ] Contact lock works in both modes

---

## Commit History (expected order)

```
feat(types): add agentic types to engine type system
feat(config): add agentic engine configuration keys
feat(engine): wire agentic loop as default pipeline
feat(phase5): accept both agentic and legacy pipeline outputs
feat(proactive): wire agentic loop into proactive pipeline
docs: update all CLAUDE.md files for v2.0 agentic architecture
chore: bump version to 2.0.0, add version bump script
fix: resolve compilation errors in agentic integration    (if needed)
chore: add @deprecated markers to legacy pipeline phases
```

---

## Risk Mitigations

### If agentic loop has runtime bugs after merge
ENGINE_MODE=legacy is always available as immediate fallback. Set `ENGINE_MODE=legacy` in .env and the system reverts to the proven 5-phase pipeline.

### If Phase 5 breaks with optional params
The overload approach (Step 4.2) ensures existing callers are not affected. If the overload is too complex, use a wrapper function `phase5ValidateAgentic()` that converts agentic params to the legacy format.

### If circular imports appear
Move shared types to `src/engine/types.ts` (already the plan). If runtime code creates cycles, use dependency injection: pass the needed function as a parameter instead of importing it.

### If compilation takes too long
Run `npx tsc --noEmit` after EVERY step, not just at the end. Catch errors early.

### If ExecutionQueue integration is complex
Defer it. Leave a TODO comment and a follow-up task. The core agentic wiring is more important than the concurrency refinement.
