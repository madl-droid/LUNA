# LUNA v2.0.0 — Audit Plans

## How Audits Work
- Each audit runs as a separate Claude Code session (LLM: sonnet)
- The auditor reads the instance plan, then inspects ALL files created/modified
- The auditor checks against acceptance criteria
- The auditor creates a report file at docs/plans/reset-v2/audit-report-{N}.md
- If issues found: list them with severity (CRITICAL/HIGH/MEDIUM/LOW) and fix instructions
- If all clear: mark as PASSED

---

## Audit 1: Engine Agentic Core
Branch: reset/instance-1-engine
LLM: sonnet

### Pre-flight
- Read /docker/luna-repo/docs/plans/reset-v2/instance-1-engine.md
- Read /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md

### Checks

1. **Compilation**: Run `npx tsc --noEmit` — must pass with ZERO errors
2. **Reuse compliance**:
   - Verify agentic-loop.ts imports callLLM/callLLMWithFallback from engine/utils/llm-client.ts (NOT creates its own)
   - Verify tool execution goes through registry.getOptional('tools:registry').executeTool() (NOT direct calls)
   - Verify StepSemaphore from engine/concurrency/ is used for parallel tool execution
   - Verify NO new DB tables were created (check migrations/)
   - Verify NO new registry.provide() calls (agentic loop is not a service)
   - Verify existing types (ContextBundle, CompositorOutput, LLMCallOptions) are imported from their original locations
3. **Type safety**:
   - AgenticResult includes all needed fields (responseText, toolCallsLog, turns, tokens, partialText)
   - EffortLevel is properly typed as union, not string
   - agentic-loop.ts accepts ContextBundle (not a custom type)
   - post-processor.ts returns CompositorOutput (reused type)
4. **Logic correctness**:
   - Agentic loop terminates: has turn limit AND can handle no-tool responses
   - Tool dedup cache: check that write tools are excluded from caching
   - Loop detector: verify 3 detection strategies (repeat, no-progress, ping-pong)
   - Loop detector: verify graduated thresholds (warn < block < circuit)
   - Effort router: verify deterministic (no LLM calls)
   - Post-processor: verify criticizer is optional/smart mode
   - Subagent fresh context: verify history is stripped from child context
5. **Error handling**:
   - Tool execution errors are caught and returned as error context (not thrown)
   - LLM call failures have fallback (callLLMWithFallback used)
   - Partial text recovery works when loop times out
   - Loop detector circuit break forces text response
6. **File inventory**: Verify ALL files from the plan were created, no extra files
7. **CLAUDE.md**: Verify engine CLAUDE.md was updated

### Output
Create docs/plans/reset-v2/audit-report-1.md with findings.

---

## Audit 2: Prompt System Rebuild
Branch: reset/instance-2-prompts
LLM: sonnet

### Pre-flight
- Read /docker/luna-repo/docs/plans/reset-v2/instance-2-prompts.md
- Read /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md

### Checks

1. **Compilation**: Run `npx tsc --noEmit` — must pass with ZERO errors
2. **Reuse compliance**:
   - Verify agentic.ts uses registry.getOptional('prompts:service') for prompt loading
   - Verify uses promptsService.getCompositorPrompts(userType) for identity/job/guardrails/relationship
   - Verify uses loadSystemPrompt() from template-loader.ts for system templates
   - Verify uses escapeForPrompt(), escapeDataForPrompt(), wrapUserContent() from prompt-escape.ts
   - Verify uses configStore.get() for dynamic console settings
   - Verify NO new DB tables created
   - Verify NO new registry services created
   - Verify prompt_slots table is used (not a new table)
3. **Prompt assembly correctness**:
   - System prompt has sections in correct order: security → identity → job → guardrails → relationship → accent → agentic_instructions → channel_format → voice → quality_checklist → tools → skills → knowledge → datetime
   - Each section is clearly tagged (XML tags or markdown headers)
   - Identity includes dynamic fields (name, last name, title, company, language, country)
   - Channel format loads dynamically from config_store
   - Accent loads from PromptsService.getAccent() or config_store
   - Voice/TTS section only included when responseFormat='audio'
4. **Context builder**:
   - context-builder.ts extracts logic from evaluator.ts (not duplicates it)
   - evaluator.ts now calls context-builder.ts (verify import)
   - Context includes: memory, knowledge, commitments, history, campaign, qualification, HITL
5. **Skills system**:
   - SkillDefinition interface exists with name, description, file, userTypes
   - Skill .md files exist in instance/prompts/system/skills/
   - Skill catalog builder produces compact stubs
6. **Proactive mode**:
   - buildAgenticPrompt supports isProactive option
   - Proactive prompt uses proactive-agentic-system.md (not evaluator prompt)
   - NO_ACTION instruction is included for proactive mode
7. **File inventory**: Verify ALL files from the plan were created
8. **Backward compatibility**: Legacy evaluator.ts still works (imports context-builder)
9. **CLAUDE.md**: Verify prompts module CLAUDE.md was updated

### Output
Create docs/plans/reset-v2/audit-report-2.md with findings.

---

## Audit 3: Proactivity + Tools + Queue
Branch: reset/instance-3-proactivity
LLM: sonnet

### Pre-flight
- Read /docker/luna-repo/docs/plans/reset-v2/instance-3-proactivity-tools.md
- Read /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md

### Checks

1. **Compilation**: Run `npx tsc --noEmit` — must pass with ZERO errors
2. **Reuse compliance**:
   - Two-tier: ToolDefinition extended (not replaced) with shortDescription, detailedGuidance
   - Tool converter uses shortDescription (falls back to description)
   - Smart cooldown uses Redis (not new DB table)
   - Orphan recovery queries existing messages table (not new table)
   - Conversation guard uses Redis for caching (not new table)
   - Guards.ts is extended (guard #8 added), not rewritten
   - proactive-runner.ts is extended (new job type), not rewritten
   - NO new registry services created
3. **Smart cooldown logic**:
   - Redis key pattern is correct (cooldown:{contactId}:{triggerType})
   - Timing is adaptive: sent=30m, no_action=60m, consecutive=120m, error=10m
   - Max backoff is enforced (24h default)
   - TTL is set on Redis keys
4. **Orphan recovery logic**:
   - SQL query is correct: finds user messages without subsequent assistant response
   - Grace period (5 min) prevents false positives on active pipelines
   - Limit prevents overwhelming the system
   - Re-dispatch uses existing message:incoming hook
5. **Conversation guard logic**:
   - Goodbye patterns are sensible for Spanish (gracias, bye, adios, etc.)
   - Cache TTL is reasonable (6h)
   - Skip for commitment follow-ups works
6. **Execution queue**:
   - Three lanes with correct priority order (reactive > proactive > background)
   - Global max enforced
   - Wraps (not replaces) PipelineSemaphore and ContactLock
7. **proactive.json**: New sections added correctly, doesn't break existing config
8. **File inventory**: Verify ALL files from plan were created
9. **CLAUDE.md**: Verify tool and proactive CLAUDE.md files updated

### Output
Create docs/plans/reset-v2/audit-report-3.md with findings.

---

## Audit 4: Integration + Globals
Branch: reset/instance-4-integration (created after merge of 1+2+3)
LLM: sonnet

### Pre-flight
- Read /docker/luna-repo/docs/plans/reset-v2/instance-4-integration.md
- Read ALL instance plans (1, 2, 3) to understand what was created
- Read /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md

### Checks

1. **Compilation**: Run `npx tsc --noEmit` — MUST pass with ZERO errors. This is the integration check.
2. **Engine.ts agentic path**:
   - Feature flag ENGINE_MODE works (agentic vs legacy)
   - Agentic path calls: classifyEffort → buildAgenticPrompt → runAgenticLoop → postProcess → phase5Validate
   - Legacy path is UNCHANGED (no modifications to existing Phase 2-4 calls)
   - ACK system (aviso) works in both modes
   - Contact lock works in both modes
   - Pipeline logging works in both modes
3. **Config.ts**:
   - All new config keys have sensible defaults
   - Uses existing helper functions (numEnv, boolEnv, etc.)
   - EngineConfig interface is extended (not replaced)
4. **Types.ts**:
   - Re-exports agentic types correctly
   - PipelineResult has optional agenticResult field
   - No breaking changes to existing types
5. **Phase 5 adaptation**:
   - evaluation parameter is optional (null in agentic mode)
   - execution parameter is optional (null in agentic mode)
   - Tool call logging works from AgenticResult.toolCallsLog
   - No crashes when evaluation/execution are null
6. **Proactive pipeline**:
   - Uses agentic loop when ENGINE_MODE='agentic'
   - Falls back to legacy when ENGINE_MODE='legacy'
   - Smart cooldown is integrated
   - Conversation guard is active
7. **Version**:
   - package.json version is "2.0.0"
   - CHANGELOG.md exists with v2.0.0 entry
   - bump-version.sh exists and is executable
8. **CLAUDE.md files**: All relevant CLAUDE.md files updated
9. **No orphaned code**:
   - No unused imports
   - No files that nothing references
   - Legacy code behind feature flag, not deleted
10. **No circular dependencies**: Check import graph
11. **Cross-instance integration**:
    - Instance 1's agentic-loop.ts correctly imported and called
    - Instance 2's buildAgenticPrompt correctly imported and called
    - Instance 3's ExecutionQueue correctly imported and used
    - Instance 3's smart cooldown integrated in proactive pipeline

### Output
Create docs/plans/reset-v2/audit-report-4.md with findings.

---

## Audit 5: Console Updates
Branch: reset/instance-5-console (created after merge of instance 4)
LLM: sonnet

### Pre-flight
- Read /docker/luna-repo/docs/plans/reset-v2/instance-5-console.md
- Read the console manifest to understand the pattern

### Checks

1. **Compilation**: Run `npx tsc --noEmit` — must pass with ZERO errors
2. **Page rendering**: For each modified page:
   - Check that the HTML template/renderer function doesn't have syntax errors
   - Check that field definitions follow the manifest pattern
   - Check that config keys match what was defined in config.ts
3. **i18n**: Every new label has BOTH es and en translations
4. **Form persistence**:
   - All new fields use config_store for persistence
   - Fields have correct types (boolean, number, select, text, textarea)
   - Default values match config.ts defaults
5. **Hot-reload**: New config keys are picked up by console:config_applied hook
6. **Identity page**:
   - Accent select field works
   - Custom accent textarea shows/hides based on selection
   - Existing identity fields NOT broken
7. **Tools page**:
   - shortDescription field visible for each tool
   - detailedGuidance textarea visible for each tool
8. **Subagents page**:
   - Fresh context toggle visible
9. **Advanced page**:
   - ENGINE_MODE selector visible
   - Agentic config fields visible
   - Execution queue config visible
10. **No broken existing features**: Quick scan of other console pages

### Output
Create docs/plans/reset-v2/audit-report-5.md with findings.

---

## Audit Severity Levels

| Level | Meaning | Action |
|---|---|---|
| CRITICAL | Won't compile or will crash at runtime | MUST fix before merge |
| HIGH | Logic error or missing feature from plan | SHOULD fix before merge |
| MEDIUM | Suboptimal but functional | Can fix in follow-up |
| LOW | Style, naming, docs | Fix when convenient |

## Fix Protocol
If CRITICAL or HIGH issues found:
1. Auditor lists specific fixes needed with file paths and line numbers
2. The same instance is re-run with fix instructions
3. Re-audit after fixes
4. Only merge when all CRITICAL and HIGH are resolved
