# Audit Plan — Instance 1: Engine Agentic Core

**Branch**: `reset/instance-1-engine`
**LLM**: `sonnet`

## Pre-Audit: Read These First
- /docker/luna-repo/docs/plans/reset-v2/instance-1-engine.md (the plan)
- /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md
- ALL new files in src/engine/agentic/
- src/engine/subagent/subagent.ts (modified)

## Audit Checklist

### 1. Compilation
```bash
npx tsc --noEmit
```
Must pass with ZERO errors. Fix any issues found.

### 2. File Inventory — Verify all planned files exist
- [ ] src/engine/agentic/types.ts
- [ ] src/engine/agentic/effort-router.ts
- [ ] src/engine/agentic/tool-dedup-cache.ts
- [ ] src/engine/agentic/tool-loop-detector.ts
- [ ] src/engine/agentic/agentic-loop.ts
- [ ] src/engine/agentic/post-processor.ts
- [ ] src/engine/agentic/index.ts
- [ ] src/engine/CLAUDE.md (updated)

### 3. Reuse Compliance — NO duplicated code
Check that:
- [ ] ALL LLM calls use `callLLM()` or `callLLMWithFallback()` from `engine/utils/llm-client.ts` — NOT direct SDK calls
- [ ] ALL tool execution uses `toolRegistry.executeTool()` from `tools:registry` service — NOT custom tool handlers
- [ ] Tool definitions fetched via `toolRegistry.getEnabledToolDefinitions()` — NOT hardcoded
- [ ] Native format conversion uses `toNativeTools()` from `tool-converter.ts` — NOT custom conversion
- [ ] Parallel tool execution uses `StepSemaphore` from `engine/concurrency/` — NOT custom Promise.all without limits
- [ ] Channel formatting uses `formatForChannel()` from `engine/utils/message-formatter.ts`
- [ ] Security escaping uses functions from `engine/utils/prompt-escape.ts`
- [ ] Output type is `CompositorOutput` (reused from engine/types.ts) — NOT a new output type
- [ ] NO new DB tables created
- [ ] NO new registry services created (registry.provide)
- [ ] NO new hooks defined

### 4. Agentic Loop Logic
- [ ] Loop correctly terminates when LLM returns no tool_calls
- [ ] Loop respects maxTurns limit
- [ ] Tool calls are passed correctly in Anthropic format (tool_use + tool_result messages)
- [ ] Tool errors are returned to LLM as context (error-as-context pattern) — NOT silently swallowed or retried blindly
- [ ] Partial text recovery works: if timeout occurs after some text, that text is captured
- [ ] Token usage is tracked (inputTokens + outputTokens accumulated across turns)

### 5. Tool Dedup Cache
- [ ] Cache key is hash of toolName + serialized input
- [ ] Write/side-effect tools are excluded from cache
- [ ] Cache is scoped to a single pipeline run (not global/persistent)
- [ ] Cache is cleared after loop completes

### 6. Loop Detector
- [ ] Detects repeated identical calls (same tool + same params)
- [ ] Detects no-progress patterns (same result)
- [ ] Detects ping-pong patterns (alternating tools)
- [ ] Graduated response: warn → block → circuit-break
- [ ] When circuit-break triggers, loop forces text response (doesn't hang)

### 7. Effort Router
- [ ] Deterministic (no LLM call)
- [ ] Returns 'low', 'medium', or 'high'
- [ ] Considers: message length, attachment presence, question patterns, new contact
- [ ] Fast (<5ms expected)

### 8. Post-Processor
- [ ] Produces `CompositorOutput` (exact type match)
- [ ] Calls `formatForChannel()` for channel-specific formatting
- [ ] TTS integration uses `tts:service` via registry.getOptional
- [ ] Criticizer is conditional (smart mode — only for complex/objection scenarios)
- [ ] If criticizer fails, original text is used (fail-open)

### 9. Subagent Fresh Context
- [ ] `runSubagentV2()` creates minimal context (strips history, knowledge, memory)
- [ ] Keeps: contactId, agentId, userType, userPermissions, traceId, contact, session
- [ ] Omits: history, bufferSummary, relevantSummaries, knowledgeMatches
- [ ] Depth limit still enforced (max 1 level)

### 10. Code Quality
- [ ] All imports use .js extensions (ESM requirement)
- [ ] No `any` types used
- [ ] Proper error handling (try/catch in loop, graceful degradation)
- [ ] Logging uses existing pino logger pattern
- [ ] No console.log statements
- [ ] No hardcoded API keys, URLs, or secrets

### 11. Boundary Respect
- [ ] Does NOT modify engine.ts (Instance 4's responsibility)
- [ ] Does NOT modify engine/types.ts (Instance 4's responsibility)
- [ ] Does NOT modify engine/config.ts (Instance 4's responsibility)
- [ ] Does NOT modify any module under src/modules/ (except subagent.ts)
- [ ] Does NOT modify any prompt files (Instance 2's responsibility)
- [ ] Does NOT modify proactive/ files (Instance 3's responsibility)

## Fix Protocol
If issues are found:
1. Fix compilation errors first
2. Fix reuse violations second (replace custom code with existing functions)
3. Fix logic errors third
4. Commit fixes with message: `audit(instance-1): fix [description]`
