# Audit Plan — Instance 3: Proactivity + Tools + Queue

**Branch**: `reset/instance-3-proactivity`
**LLM**: `sonnet`

## Pre-Audit: Read These First
- /docker/luna-repo/docs/plans/reset-v2/instance-3-proactivity-tools.md (the plan)
- /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md
- ALL new/modified files from Instance 3

## Audit Checklist

### 1. Compilation
```bash
npx tsc --noEmit
```
Must pass with ZERO errors.

### 2. File Inventory
- [ ] src/engine/proactive/smart-cooldown.ts
- [ ] src/engine/proactive/orphan-recovery.ts
- [ ] src/engine/proactive/conversation-guard.ts
- [ ] src/engine/concurrency/execution-queue.ts
- [ ] CLAUDE.md files updated

### 3. Reuse Compliance
- [ ] Tool types extend existing `ToolDefinition` — NOT new interface
- [ ] Tool registry methods are EXTENDED — NOT replaced or duplicated
- [ ] `toNativeTools()` uses shortDescription from existing field — NOT custom converter
- [ ] Smart cooldown uses REDIS (existing connection from registry.getRedis()) — NOT new Redis connection
- [ ] Orphan recovery queries existing `messages` table — NOT new table
- [ ] Conversation guard uses existing `messages` table — NOT new table
- [ ] Proactive outreach logs use existing `proactive_outreach_log` table
- [ ] Guards extend existing guards.ts array — NOT new guard system
- [ ] Proactive runner extends existing BullMQ setup — NOT new queue
- [ ] Execution queue wraps existing PipelineSemaphore + ContactLock — NOT replaces them
- [ ] NO new DB tables created
- [ ] NO new registry services created
- [ ] NO new hooks defined

### 4. Two-Tier Tool Descriptions
- [ ] `ToolDefinition` has `shortDescription?: string` and `detailedGuidance?: string`
- [ ] `registerTool()` auto-generates shortDescription from first sentence if not provided
- [ ] `getCatalog()` returns shortDescription when available
- [ ] `getEnabledToolDefinitions()` uses shortDescription in definition
- [ ] `toAnthropicTools()` uses shortDescription for description field
- [ ] `toGeminiTools()` uses shortDescription for description field
- [ ] `getToolGuidance(name)` returns detailedGuidance
- [ ] Existing tools still work without shortDescription (backwards compatible)

### 5. Smart Cooldown
- [ ] `CooldownState` stored in Redis (key: `cooldown:{contactId}:{triggerType}`)
- [ ] TTL on Redis keys (default 7 days)
- [ ] Adaptive timing: sent=30min, no_action=60min, consecutive_no_action=120min, error=10min, blocked=240min
- [ ] Max backoff: 24 hours
- [ ] `calculateNextCheck()` returns a Date
- [ ] `getCooldownState()` returns null if not found
- [ ] `updateCooldownState()` increments consecutiveNoActions correctly

### 6. Orphan Recovery
- [ ] SQL query finds messages where role='user' with no subsequent assistant reply
- [ ] Grace period: at least 5 minutes before considering orphan
- [ ] Lookback window is configurable (default 30 min)
- [ ] Limit per run is configurable (default 10)
- [ ] Does NOT re-process messages currently in active pipeline
- [ ] Re-dispatches via `registry.runHook('message:incoming', ...)` — correct hook
- [ ] Logs to proactive_outreach_log with triggerType='orphan_recovery'

### 7. Conversation Guard
- [ ] Detects goodbye patterns in Spanish: "gracias", "adiós", "hasta luego", "bye", etc.
- [ ] Checks last 3 messages in session (not entire history)
- [ ] Caches result in Redis (TTL configurable, default 6h)
- [ ] Returns `{ suppress: boolean; reason?: string }`
- [ ] Skippable for commitment follow-ups
- [ ] Integrated into guards.ts as guard #8

### 8. Execution Queue
- [ ] Three lanes: reactive, proactive, background
- [ ] Priority ordering: reactive (100) > proactive (50) > background (10)
- [ ] Per-lane concurrency limits configurable
- [ ] Global max configurable
- [ ] Higher-priority lanes are preferred when global max is reached
- [ ] Wraps PipelineSemaphore and ContactLock (uses them, doesn't replace)
- [ ] `drain()` method for graceful shutdown
- [ ] `getStats()` returns current state per lane

### 9. Configuration
- [ ] proactive.json has smart_cooldown section
- [ ] proactive.json has orphan_recovery section
- [ ] proactive.json has conversation_guard section
- [ ] All new features are toggleable (enabled: true/false)
- [ ] Defaults are sensible

### 10. Code Quality
- [ ] All imports use .js extensions (ESM)
- [ ] No `any` types
- [ ] Proper error handling
- [ ] Redis operations have error handling (don't crash on Redis failure)
- [ ] SQL queries use parametrized queries ($1, $2) — no string interpolation
- [ ] Logging uses pino pattern

### 11. Boundary Respect
- [ ] Does NOT modify engine.ts, types.ts (except importing new tool types)
- [ ] Does NOT modify phase1-intake.ts, phase5-validate.ts
- [ ] Does NOT modify any prompt files
- [ ] Does NOT modify engine/agentic/ directory
- [ ] Does NOT modify channel modules (whatsapp, gmail, etc.)

## Fix Protocol
1. Fix compilation errors
2. Fix reuse violations
3. Fix SQL injection risks (parametrized queries)
4. Fix Redis error handling
5. Commit: `audit(instance-3): fix [description]`
