# Audit Plan — Instance 4: Integration + Globals

**Branch**: `reset/instance-4-integration`
**LLM**: `opus`

## Pre-Audit: Read These First
- /docker/luna-repo/docs/plans/reset-v2/instance-4-integration.md (the plan)
- /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md
- ALL modified files from Instance 4

## Audit Checklist

### 1. Compilation (CRITICAL)
```bash
npx tsc --noEmit
```
This is the MOST critical check. Instance 4 touches the central files. ZERO errors.

### 2. Feature Flag — Legacy Mode Works
- [ ] Set ENGINE_MODE=legacy in environment
- [ ] Verify engine.ts routes to Phase 2 → 3 → 4 path
- [ ] Verify NO agentic code is executed in legacy mode
- [ ] Verify Phase 5 receives full EvaluatorOutput + ExecutionOutput in legacy mode
- [ ] Verify pipeline_logs record engineMode='legacy'

### 3. Feature Flag — Agentic Mode Works
- [ ] Set ENGINE_MODE=agentic (default)
- [ ] Verify engine.ts routes to agentic path
- [ ] Verify Phase 1 output (ContextBundle) flows correctly to buildAgenticPrompt()
- [ ] Verify tool definitions are fetched and converted
- [ ] Verify runAgenticLoop() is called with correct parameters
- [ ] Verify post-processor produces CompositorOutput
- [ ] Verify Phase 5 receives CompositorOutput correctly
- [ ] Verify pipeline_logs record engineMode='agentic'

### 4. Type Extensions
- [ ] PipelineResult has new fields: agenticResult?, effortLevel?, engineMode
- [ ] EngineConfig has all new keys from config.ts
- [ ] AgenticConfig, AgenticResult, EffortLevel properly re-exported from types.ts
- [ ] ALL existing types unchanged (no breaking changes)
- [ ] No `as any` casts to work around type issues

### 5. Config Extensions
- [ ] All new ENGINE_* and LLM_*_EFFORT_* keys present in loadEngineConfig()
- [ ] All have sensible defaults
- [ ] ENGINE_MODE defaults to 'agentic'
- [ ] Existing config keys unchanged
- [ ] getEngineConfig() returns the full extended config

### 6. Engine.ts Wiring
- [ ] processMessageInner() branches on config.engineMode
- [ ] Agentic path: Phase 1 → effort → tools → prompt → loop → post-process → Phase 5
- [ ] ACK (aviso) system wraps BOTH paths
- [ ] ContactLock wraps BOTH paths
- [ ] ExecutionQueue integration: reactive lane for incoming messages
- [ ] Error handling: if agentic loop fails, log error and return fallback
- [ ] Timing: phase durations logged for agentic mode (phase2+3+4 combined as agenticDurationMs)

### 7. Phase 5 Adaptation
- [ ] evaluation and execution parameters are OPTIONAL
- [ ] When called from agentic path, receives CompositorOutput with agentic metadata
- [ ] Commitment detection still works (scans responseText)
- [ ] Message persistence still works
- [ ] Proactive signals still fire
- [ ] Channel send still works
- [ ] Pipeline logging includes engineMode

### 8. Proactive Pipeline
- [ ] Uses agentic loop when ENGINE_MODE=agentic
- [ ] buildAgenticPrompt called with isProactive=true
- [ ] Lower maxTurns for proactive (configurable, default 5)
- [ ] Smart cooldown integrated
- [ ] Orphan recovery job registered
- [ ] Conversation guard in guard chain
- [ ] Falls back to legacy if agentic fails

### 9. CLAUDE.md Files
- [ ] Root CLAUDE.md mentions v2.0.0 and agentic architecture
- [ ] Engine CLAUDE.md has full new architecture description
- [ ] All module CLAUDE.md files checked for stale pipeline references
- [ ] No CLAUDE.md references "Phase 2 evaluator" as the current architecture (should say "legacy")

### 10. Version & Scripts
- [ ] package.json version is "2.0.0"
- [ ] scripts/version-bump.js exists and works
- [ ] Version bump script validates bump type (major/minor/patch)

### 11. Deprecation Markers
- [ ] phase2-evaluate.ts has @deprecated JSDoc
- [ ] phase3-execute.ts has @deprecated JSDoc
- [ ] phase4-compose.ts has @deprecated JSDoc
- [ ] engine/prompts/evaluator.ts has @deprecated JSDoc (if not shared)
- [ ] Deprecated files still compile and are importable

### 12. No Circular Imports
```bash
# Check for circular imports (manual inspection)
# In agentic-loop.ts: should NOT import from engine.ts
# In engine.ts: should import from agentic/ cleanly
# In types.ts: should only re-export from agentic/types.ts
```

### 13. ESM Compliance
- [ ] ALL relative imports use .js extensions
- [ ] No require() calls
- [ ] No __dirname usage (use import.meta.url if needed)

### 14. Integration Coherence
- [ ] Effort router output matches model selection in engine.ts
- [ ] Tool definitions from registry match what agentic loop expects
- [ ] Prompt builder output matches what agentic loop expects as input
- [ ] Post-processor output matches what Phase 5 expects
- [ ] Proactive pipeline uses same agentic infrastructure as reactive

## Fix Protocol
1. Compilation errors are BLOCKERS — fix immediately
2. Feature flag issues — ensure both modes work
3. Type mismatches — fix without breaking existing code
4. Missing integration points — wire correctly
5. Commit: `audit(instance-4): fix [description]`
