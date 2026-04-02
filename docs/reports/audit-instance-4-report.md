# Audit Report — Instance 4: Integration + Globals

**Auditor**: Claude (Opus 4.6)
**Date**: 2026-04-02
**Branch**: `claude/infrastructure-reset-v2-OBWQv`
**Base commit**: `2d353e5` (feat(engine): integrate agentic loop as default pipeline (v2.0.0))

---

## Executive Summary

Instance 4 integration is **solid**. The agentic pipeline is correctly wired into `engine.ts`, both modes (agentic/legacy) work as designed, types and config are properly extended, Phase 5 handles both modes cleanly, and the proactive pipeline has a complete agentic branch. Only **1 compilation error** found (unused import, already fixed). No `as any` casts. No circular imports. Full ESM compliance.

**Verdict**: ✅ PASS with minor findings

---

## Checklist Results

### 1. Compilation (CRITICAL) — ✅ PASS
- `npx tsc --noEmit` produces **0 errors** after fix
- **Finding F-1**: `src/engine/agentic/tool-dedup-cache.ts` had unused import `ToolCallLog` (TS6133). **Fixed** — removed the import.

### 2. Feature Flag — Legacy Mode — ✅ PASS
- `ENGINE_MODE=legacy` routes to Phase 2 → 3 → 4 → 5 path (engine.ts:324-564)
- Agentic code is **not executed** in legacy mode — the `if (engineConfig.engineMode === 'agentic')` branch at line 309 is the only gate
- Phase 5 receives full `EvaluatorOutput` + `ExecutionOutput` in legacy mode (line 499)
- `PipelineResult` includes `engineMode: 'legacy'` at all legacy return sites (lines 171, 254, 295, 564, 616)
- Proactive pipeline: legacy path at line 96-202 is completely unchanged

### 3. Feature Flag — Agentic Mode — ✅ PASS
- `ENGINE_MODE=agentic` (default) routes to `runAgenticPipeline()` at line 309-321
- Phase 1 output (`ContextBundle`) flows correctly to `buildAgenticPrompt()` (line 682)
- Tool definitions fetched via `registry.getOptional<ToolRegistryLike>('tools:registry')` (line 676)
- `runAgenticLoop()` called with correct parameters: `(ctx, systemPrompt, llmToolDefs, agenticConfig, reg)` (line 700-706)
- Post-processor produces `CompositorOutput` (line 714)
- Phase 5 receives `CompositorOutput` + `null` evaluation (line 718)
- Pipeline log records `toolsCalled: agenticResult.toolsUsed` (line 744)
- `PipelineResult` includes `engineMode: 'agentic'`, `agenticResult`, `effortLevel` (lines 771-773)

### 4. Type Extensions — ✅ PASS
- `PipelineResult` extended with `agenticResult?`, `effortLevel?`, `engineMode?` (types.ts:329-333)
- `engineMode` is correctly optional with default-to-legacy semantics (comment at line 332)
- Agentic types re-exported from `./agentic/types.js` (types.ts:7-12)
- `AgenticPipelineOptions` interface added (types.ts:339-343)
- All existing types unchanged — no breaking changes
- **No `as any` casts** anywhere in engine directory

### 5. Config Extensions — ✅ PASS
- All new `ENGINE_*` and `LLM_*_EFFORT_*` keys present in `loadEngineConfig()` (config.ts:152-165)
- `EngineConfig` interface extended with 13 new agentic fields (types.ts:691-714)
- `engineMode` defaults to `'agentic'` (config.ts:153)
- Low effort provider types are `LLMProvider` (not plain string) — correct
- Existing config keys are completely unchanged
- `getEngineConfig()` returns the full extended config (engine.ts:789)

### 6. Engine.ts Wiring — ✅ PASS
- `processMessageInner()` branches on `engineConfig.engineMode` at line 309
- Agentic path: Phase 1 → effort → tools → prompt → loop → post-process → Phase 5 (lines 655-775)
- ACK system wraps the entire pipeline via `message:incoming` hook handler — mode-agnostic ✅
- ContactLock wraps both paths (`contactLock.withLock` at line 176) — mode-agnostic ✅
- PipelineSemaphore wraps both paths (lines 150-188) — mode-agnostic ✅
- Error handling in agentic mode: errors propagate to the top-level catch (line 566) which sends error fallback — correct ✅
- Composing signal sent before agentic loop (lines 311-316) — correct ✅
- **Note**: ACK aviso timer is NOT set in agentic mode (by design — the agentic loop manages its own pacing via composing signals)

### 7. Phase 5 Adaptation — ✅ PASS
- `evaluation` parameter changed from `EvaluatorOutput` to `EvaluatorOutput | null` (phase5-validate.ts:58)
- JSDoc clearly explains: "When null, intent/emotion metadata is omitted" (lines 50-53)
- All `evaluation` usages guarded with `?.` or null checks:
  - `evaluation?.intent === 'farewell'` (line 203) — safely no-ops in agentic mode
  - `evaluation?.objectionType` (line 170) — safely no-ops in agentic mode
  - `evaluation ?? null` passed to `persistMessages` (line 156) — handles null
- Commitment detection works: `detectCommitments()` scans `responseText` directly (line 212) — mode-agnostic ✅
- Message sending works identically in both modes ✅
- Pipeline logging works: no agentic-specific columns needed (uses existing fields) ✅

### 8. Proactive Pipeline — ✅ PASS
- Agentic branch at line 89-94: `if (engineConfig.engineMode === 'agentic')` → `runProactiveAgentic()`
- `buildAgenticPrompt()` called with `isProactive: true` (line 296)
- Lower maxTurns: `Math.min(engineConfig.agenticMaxTurns, 5)` (line 303)
- Effort capped: `classifyEffort(ctx) === 'high' ? 'medium' : 'low'` (line 283)
- Smart cooldown integrated: `updateCooldownState()` called after success/error (lines 148, 161, 260, 369)
- Conversation guard integrated: `shouldSuppressProactive()` checked before pipeline (lines 250-279)
- NO_ACTION check: scans for `[NO_ACTION]` sentinel (line 321)
- Legacy path completely unchanged (lines 96-225)
- **Note**: Orphan recovery is **not wired** in this pipeline — it's handled by its own trigger job in `proactive-runner.ts` (by design)

### 9. CLAUDE.md Files — ✅ PASS (minor stale refs)
| File | Status | Note |
|------|--------|------|
| `/CLAUDE.md` (root) | ✅ Current | Mentions dual-mode, agentic default |
| `src/engine/CLAUDE.md` | ⚠️ Minor | Line 1 says "Pipeline de 5 fases" — misleading but context clarifies |
| `src/engine/checkpoints/CLAUDE.md` | ✅ Current | Notes legacy-mode-only |
| `src/modules/engine/CLAUDE.md` | ✅ Current | Explicit mode documentation |
| `src/modules/tools/CLAUDE.md` | ⚠️ Minor | Line 3 says "Phase 3" — should add "or agentic loop" |
| `src/modules/prompts/CLAUDE.md` | ⚠️ Minor | Evaluator slot not marked as legacy |
| `deploy/CLAUDE.md` | ✅ Current | ENGINE_MODE documented |

### 10. Version & Scripts — ✅ PASS
- `package.json` version: `"2.0.0"` ✅
- `scripts/version-bump.js` exists and has valid logic for major/minor/patch ✅
- `"version:bump"` script registered in package.json ✅

### 11. Deprecation Markers — ✅ PASS
All four files have `@deprecated` JSDoc at file level:
- `src/engine/phases/phase2-evaluate.ts` ✅
- `src/engine/phases/phase3-execute.ts` ✅
- `src/engine/phases/phase4-compose.ts` ✅
- `src/engine/prompts/evaluator.ts` ✅

### 12. No Circular Imports — ✅ PASS
- All 7 files in `src/engine/agentic/` checked — **zero** imports from `engine.ts`
- Only imports: types.ts, utils/, concurrency/, kernel/registry.js, peer agentic modules

### 13. ESM Compliance — ✅ PASS
- All 250+ relative imports in `src/engine/` have `.js` extensions
- No `require()` calls
- No `__dirname` usage (uses `import.meta.url` where needed)

### 14. Integration Coherence — ✅ PASS
| Interface | Match? | Detail |
|-----------|--------|--------|
| `classifyEffort(ctx)` → returns `EffortLevel` | ✅ | Sync function, returns 'low'/'medium'/'high' |
| `getModelForEffort(effort, config)` → `{model, provider}` | ✅ | Correctly maps effort→model per config |
| `buildAgenticPrompt(ctx, toolCatalog, reg, opts)` → `{system, userMessage}` | ✅ | engine.ts uses `.system` (line 683) |
| `runAgenticLoop(ctx, prompt, tools, config, reg)` → `AgenticResult` | ✅ | All 5 params passed correctly |
| `postProcess(result, ctx, config, reg)` → `CompositorOutput` | ✅ | Output fed to Phase 5 |
| `phase5Validate(ctx, composed, evaluation, reg, db, redis, config)` → `DeliveryResult` | ✅ | Agentic passes `null` for evaluation |
| `AgenticConfig` fields match `EngineConfig` mapping | ✅ | All fields mapped in engine.ts:686-697 |

---

## Findings Summary

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| F-1 | BLOCKER | `agentic/tool-dedup-cache.ts` | Unused import `ToolCallLog` (TS6133) | **FIXED** |
| F-2 | INFO | `src/engine/CLAUDE.md` | Line 1 opener says "5 fases" — misleading | Cosmetic, low priority |
| F-3 | INFO | `src/modules/tools/CLAUDE.md` | Line 3 references only Phase 3 for tool invocation | Cosmetic, low priority |
| F-4 | INFO | `engine.ts` | ACK aviso timer not active in agentic mode | By design — agentic loop manages pacing |
| F-5 | INFO | `proactive-pipeline.ts` | LLMToolDef conversion duplicated (vs engine.ts toLLMToolDefs) | Minor duplication, not a bug |

---

## Fixes Applied

1. **F-1**: Removed unused `import type { ToolCallLog } from './types.js'` from `src/engine/agentic/tool-dedup-cache.ts`
2. Verified `npx tsc --noEmit` passes with 0 errors after fix

---

## Conclusion

Instance 4 is well-executed. The integration:
- Correctly wires the agentic pipeline as default
- Preserves the legacy pipeline behind a clean feature flag
- Makes no breaking changes to existing types or interfaces
- Has proper error handling, logging, and fallback behavior
- All signatures and data flows are coherent across the 3 instances + integration layer
- Compilation is clean (0 errors after 1 minor fix)

**Ready for merge** after committing the compilation fix.
