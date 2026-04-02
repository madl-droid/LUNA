# LUNA v2.0.0 — Reset Plan Overview

## Objective
Migrate LUNA from a 5-phase pipeline (intake → evaluate → execute → compose → validate) to an **agentic loop architecture** (intake → single LLM call with tools → format → validate), informed by lessons from Pinza Colombiana, Claude Code, and OpenClaw.

## Version
- **Current**: v1.x (implicit, never formally versioned)
- **Target**: v2.0.0
- **Policy**: Every version bump requires user confirmation. Format: MAJOR.MINOR.PATCH (semver)

## Branch Strategy
```
main          ← backup of pruebas (pushed before reset)
pruebas       ← current production staging
reset         ← base branch for v2.0.0 work
  ├─ reset/instance-1-engine        (parallel)
  ├─ reset/instance-2-prompts       (parallel)
  ├─ reset/instance-3-proactivity   (parallel)
  ├─ [merge 1+2+3 to reset]
  ├─ reset/instance-4-integration   (sequential)
  ├─ [merge 4 to reset]
  └─ reset/instance-5-console       (sequential)
```

## Instance Overview

| Instance | Name | LLM | Parallel? | Focus |
|---|---|---|---|---|
| 1 | Engine Agentic Core | `opusplan` | Yes | New agentic loop replacing Phases 2+3+4 |
| 2 | Prompt System Rebuild | `sonnet` | Yes | Dynamic prompt assembly, skills, accent |
| 3 | Proactivity + Tools + Queue | `sonnet` | Yes | Smart cooldown, orphan recovery, two-tier tools, queue lanes |
| 4 | Integration + Globals | `opus` | After 1+2+3 | Wire everything, update types/config, docs, versioning |
| 5 | Console Updates | `sonnet` | After 4 | Update console UI for new engine features |

## Critical Rule: REUSE EVERYTHING
**DO NOT create new files, functions, hooks, services, tables, or types if they already exist.**
See `reuse-inventory.md` for the complete catalog of reusable code.

- Use `registry.provide()` / `registry.get()` / `registry.getOptional()` for DI
- Use existing hooks (`message:incoming`, `tools:executed`, etc.)
- Use `callLLM()` / `callLLMWithFallback()` from `llm-client.ts`
- Use `ToolRegistry.executeTool()` for tool execution
- Use `toNativeTools()` from `tool-converter.ts`
- Use `PromptsService` for prompt loading
- Use existing DB tables — NO new migrations unless absolutely necessary
- Use existing `EngineConfig` keys — extend, don't replace

## What Changes vs What Stays

### STAYS (do not modify unless explicitly stated)
- `src/kernel/` — entire kernel
- `src/modules/` — all 23 modules (except specific files noted in plans)
- `src/channels/` — all channel shared code
- `src/extractors/` — all extractors
- `src/migrations/` — existing migrations
- `src/engine/phases/phase1-intake.ts` — Phase 1 stays as-is
- `src/engine/attachments/` — attachment processing stays
- `src/engine/ack/` — ACK system stays
- `src/engine/fallbacks/` — fallback system stays
- `src/engine/concurrency/pipeline-semaphore.ts` — stays
- `src/engine/concurrency/contact-lock.ts` — stays

### CHANGES
- `src/engine/agentic/` — NEW directory with agentic loop
- `src/engine/prompts/agentic.ts` — NEW prompt builder
- `src/engine/engine.ts` — modified to use agentic loop
- `src/engine/types.ts` — extended with agentic types
- `src/engine/config.ts` — extended with agentic config
- `src/engine/phases/phase5-validate.ts` — minor adaptation
- `src/engine/proactive/` — smart cooldown, orphan recovery, conversation guard
- `src/modules/tools/` — two-tier descriptions
- `src/modules/prompts/` — skills system, accent support

### DEPRECATED (kept but behind feature flag)
- `src/engine/phases/phase2-evaluate.ts` — legacy, used when `ENGINE_MODE=legacy`
- `src/engine/phases/phase3-execute.ts` — legacy
- `src/engine/phases/phase4-compose.ts` — legacy
- `src/engine/prompts/evaluator.ts` — legacy prompt builder
- `src/engine/prompts/compositor.ts` — legacy prompt builder (parts reused in agentic.ts)

## Architecture After Reset

```
Message(s) arrive
    |
    v
Message Batcher (already exists, per-channel configurable)
    |
    v
Phase 1: Intake (unchanged)
  - Normalize, resolve contact, load context
  - Memory, knowledge, commitments, lead status
  - Output: ContextBundle (unchanged type)
    |
    v
Effort Router (NEW)
  - Classify message complexity
  - Simple → cheaper model, no tools
  - Complex → full model with tools
    |
    v
System Prompt Assembly (REBUILT)
  - identity.md + job.md + guardrails.md (from PromptsService)
  - relationship-{userType}.md (from PromptsService)
  - accent (dynamic from config_store)
  - channel-format-{channel}.md (dynamic from config_store)
  - voice/TTS tags (if audio response)
  - criticizer checklist
  - tool declarations (two-tier: short descriptions)
  - skill stubs (on-demand detailed loading)
  - knowledge catalog (filtered by userType)
    |
    v
Agentic Loop (NEW - replaces Phases 2+3+4)
  while (response.has_tool_calls && turns < max) {
    - Tool dedup cache (skip identical calls)
    - Tool loop detection (anti-loop with graduated thresholds)
    - Execute tools via existing ToolRegistry.executeTool()
    - Error-as-context (feed errors back to LLM, not retry blindly)
    - Feed results back to LLM
  }
  - LLM composes response directly in final turn
    |
    v
Post-Processing (SIMPLIFIED from Phase 4)
  - Criticizer smart mode (optional, only for complex/objections)
  - Channel formatting via formatForChannel()
  - TTS via tts:service (if audio response)
  - Partial text recovery (if timeout)
    |
    v
Phase 5: Validate + Send (minor changes)
  - Validate, send, persist, commitment detection, proactive signals
  - Orphan message tracking (NEW)

Proactive Pipeline (IMPROVED)
  - Smart cooldown (next_check_at adaptive)
  - Conversation guard (suppress if user said goodbye)
  - Execution queue with lanes (reactive > proactive > background)
  - Uses same agentic loop for response generation
```
