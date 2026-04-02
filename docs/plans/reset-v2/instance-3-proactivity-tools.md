# Instance 3 — Proactivity + Tools + Execution Queue

**Branch:** `reset/instance-3-proactivity` (created from `reset`)
**LLM:** sonnet
**Role:** Improve the proactive system, tool system, and execution queue for LUNA

---

## Context

LUNA has an existing proactive system (BullMQ jobs, guards, commitment detection) and tool system (registry, execution, access control). This instance improves both with patterns from Pinza Colombiana and OpenClaw, WITHOUT touching the engine core or prompt system.

The proactive pipeline currently runs on fixed intervals with basic guards. The tool system declares descriptions at a single level of detail. There is no priority-based execution queue differentiating reactive vs proactive vs background work.

This instance adds:

- Two-tier tool descriptions (short for LLM declarations, detailed for invocation guidance)
- Smart adaptive cooldown per contact+trigger (replaces fixed intervals)
- Orphan message recovery (detect and re-dispatch unanswered messages)
- Conversation guard (suppress outreach when the contact has said goodbye)
- Priority-based execution queue with lanes (reactive > proactive > background)

---

## Key Files to Read First

Read ALL of these completely before writing any code:

- `/docker/luna-repo/docs/plans/reset-v2/overview.md`
- `/docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md`
- `/docker/luna-repo/src/engine/proactive/proactive-runner.ts` -- BullMQ runner
- `/docker/luna-repo/src/engine/proactive/guards.ts` -- 7 protection guards
- `/docker/luna-repo/src/engine/proactive/proactive-pipeline.ts` -- simplified Phase 1 + phases 2-5
- `/docker/luna-repo/src/engine/proactive/commitment-detector.ts`
- `/docker/luna-repo/src/engine/proactive/jobs/` directory -- all job types
- `/docker/luna-repo/src/modules/tools/tool-registry.ts`
- `/docker/luna-repo/src/modules/tools/tool-converter.ts`
- `/docker/luna-repo/src/modules/tools/types.ts`
- `/docker/luna-repo/src/engine/concurrency/` -- all files
- `/docker/luna-repo/src/engine/types.ts` -- ProactiveConfig, ProactiveCandidate, etc.
- `/docker/luna-repo/instance/proactive.json` -- proactive configuration

---

## CRITICAL REUSE RULES

These rules are **non-negotiable**. Violating them will cause the work to be rejected.

- Use existing `ToolRegistry` class -- extend it, don't replace
- Use existing `guards.ts` -- add to it, don't replace
- Use existing `proactive-runner.ts` BullMQ setup -- extend, don't replace
- Use existing `PipelineSemaphore` and `ContactLock` -- don't recreate
- Use existing `StepSemaphore` for tool parallelism
- Use existing `proactive_outreach_log` table for logging
- Use existing `commitments` table
- Use existing `pipeline_logs` table
- Use existing `config_store` for dynamic settings
- Use existing hooks: `tools:before_execute`, `tools:executed`
- **DO NOT** create new DB tables
- **DO NOT** create new registry services

---

## Execution Plan

### Step 0: Setup

1. Create branch `reset/instance-3-proactivity` from `reset`
2. Read ALL key files listed above completely
3. Read `reuse-inventory.md`

---

### Step 1: Add Two-Tier Tool Descriptions to `modules/tools/`

The agentic loop sends tool declarations to the LLM with short descriptions (token-efficient). When a tool is invoked, detailed guidance is injected into the tool result message by Instance 1's post-processor.

**Modify `src/modules/tools/types.ts`:**

Add fields to `ToolDefinition`:

```typescript
interface ToolDefinition {
  // ... existing fields ...
  shortDescription?: string;     // NEW: 1-line for LLM declarations (token-efficient)
  detailedGuidance?: string;     // NEW: Full guidance injected on tool invocation
}
```

**Modify `src/modules/tools/tool-registry.ts`:**

- When registering a tool, if `shortDescription` is not provided, auto-generate from first sentence of `description`
- Add method `getToolGuidance(name: string): string | null` that returns `detailedGuidance`
- Modify `getCatalog()` to return `shortDescription` when available
- Modify `getEnabledToolDefinitions()` to use `shortDescription` in the definition sent to LLM

**Modify `src/modules/tools/tool-converter.ts`:**

- `toAnthropicTools()` and `toGeminiTools()` should use `shortDescription` (or fallback to `description`) for the description field in native tool definitions
- The full `description` stays in the `ToolDefinition` for internal use

**Impact:** When the agentic loop calls a tool and gets a result, Instance 1's post-processor can inject `detailedGuidance` into the `tool_result` message. This gives the LLM detailed context about how to interpret the result.

---

### Step 2: Create `src/engine/proactive/smart-cooldown.ts`

Replace fixed intervals with adaptive cooldown per contact+trigger.

```typescript
export interface CooldownState {
  contactId: string;
  triggerType: string;
  lastAction: 'sent' | 'no_action' | 'error' | 'blocked';
  lastActionAt: Date;
  nextCheckAt: Date;
  consecutiveNoActions: number;
}

export async function calculateNextCheck(
  state: CooldownState,
  config: ProactiveConfig,
): Promise<Date>

export async function getCooldownState(
  redis: Redis,
  contactId: string,
  triggerType: string,
): Promise<CooldownState | null>

export async function updateCooldownState(
  redis: Redis,
  contactId: string,
  triggerType: string,
  action: CooldownState['lastAction'],
): Promise<void>
```

**Adaptive logic:**

| Outcome | Next check | Rationale |
|---|---|---|
| `sent` | 30 min (default, configurable) | Message was sent; check back later |
| `no_action` | 60 min | Nothing to do; back off |
| Consecutive `no_action` (2+) | 120 min | Repeated no-ops; back off more |
| `error` | 10 min | Retry sooner after failure |
| `blocked` (by guard) | 240 min | Significant back-off; guard likely won't clear soon |

**Max backoff:** 24 hours.

**Storage:** Redis. Key pattern: `cooldown:{contactId}:{triggerType}`. TTL: 7 days.

---

### Step 3: Create `src/engine/proactive/orphan-recovery.ts`

Detect messages that never received a response and trigger re-processing.

```typescript
export interface OrphanMessage {
  messageId: string;
  contactId: string;
  channelContactId: string;
  channel: string;
  content: string;
  receivedAt: Date;
  sessionId: string;
}

export async function findOrphanMessages(
  db: Pool,
  windowMinutes: number,  // look back N minutes, default 30
  limit: number,          // max to process, default 10
): Promise<OrphanMessage[]>
```

**Detection logic:**

Query the `messages` table for messages where:

1. `role = 'user'`
2. `created_at` between `(now - windowMinutes)` and `(now - 5 min)` (5 min grace period)
3. No subsequent `role = 'assistant'` message in the same session within 5 minutes
4. Not in an active pipeline (check `pipeline_logs` for pending status)

Return the list of orphan messages. The proactive runner calls this and re-dispatches via `registry.runHook('message:incoming', ...)`.

**Add a new job type to the proactive runner: `orphan-recovery`:**

- Runs every 5 minutes (configurable)
- Uses `findOrphanMessages()` to detect orphans
- Re-dispatches each orphan via `registry.runHook('message:incoming', ...)`
- Logs to `proactive_outreach_log` with `triggerType='orphan_recovery'`

---

### Step 4: Create `src/engine/proactive/conversation-guard.ts`

Detect if a contact has "said goodbye" to suppress proactive outreach.

```typescript
export async function shouldSuppressProactive(
  db: Pool,
  redis: Redis,
  contactId: string,
  channel: string,
): Promise<{ suppress: boolean; reason?: string }>
```

**Logic:**

1. Check Redis cache first: `suppress:{contactId}:{channel}` (TTL 6h)
2. If not cached, check last 3 messages in the session:
   - Look for goodbye patterns: "gracias", "bye", "adios", "hasta luego", "perfecto gracias", "listo gracias"
   - If last user message matches AND last assistant message is a farewell response
   - Cache result in Redis with 6h TTL
3. Return `{ suppress: true, reason: 'contact_said_goodbye' }` or `{ suppress: false }`

**Guard behavior:** This guard is SKIPPABLE. If the proactive trigger is a commitment follow-up, don't suppress -- commitment follow-ups always go through.

---

### Step 5: Create `src/engine/concurrency/execution-queue.ts`

Priority-based execution queue with lanes.

```typescript
export type QueueLane = 'reactive' | 'proactive' | 'background';

export interface QueuedItem {
  id: string;
  lane: QueueLane;
  priority: number;       // higher = more urgent
  handler: () => Promise<void>;
  contactId?: string;
  enqueuedAt: Date;
}

export interface LaneConfig {
  concurrency: number;
  priority: number;
}

export interface LaneStats {
  running: number;
  queued: number;
  concurrency: number;
}

export interface RunningStats {
  running: number;
  max: number;
}

export class ExecutionQueue {
  constructor(config: {
    reactive: LaneConfig;    // default: { concurrency: 8, priority: 100 }
    proactive: LaneConfig;   // default: { concurrency: 3, priority: 50 }
    background: LaneConfig;  // default: { concurrency: 2, priority: 10 }
    globalMax: number;        // default: 12
  })

  async enqueue(
    lane: QueueLane,
    item: Omit<QueuedItem, 'id' | 'enqueuedAt' | 'priority'>,
  ): Promise<string>

  getStats(): {
    reactive: LaneStats;
    proactive: LaneStats;
    background: LaneStats;
    global: RunningStats;
  }

  async drain(timeoutMs?: number): Promise<void>
}
```

**Lane semantics:**

| Lane | Use case | Default concurrency | Default priority |
|---|---|---|---|
| `reactive` | Customer messages (highest priority, most concurrency) | 8 | 100 |
| `proactive` | Follow-ups, reminders, commitments (medium priority) | 3 | 50 |
| `background` | Subagents, batch processing, cache refresh (lowest priority) | 2 | 10 |

**Behavior:**

- When `globalMax` is reached, lower-priority lanes wait while higher-priority lanes continue
- When a lane's concurrency is reached, items queue within that lane
- Within a lane, items are processed FIFO

**IMPORTANT:** This wraps `PipelineSemaphore` + `ContactLock`, it does NOT replace them:

- `PipelineSemaphore` handles global backpressure (reuse)
- `ContactLock` handles per-contact serialization (reuse)
- `ExecutionQueue` adds lane-based prioritization on top

---

### Step 6: Modify `src/engine/proactive/guards.ts`

Add the conversation guard to the existing guard chain.

- Import `shouldSuppressProactive` from `conversation-guard.ts`
- Add as guard #8 (after existing 7 guards)
- Make it configurable: `PROACTIVE_CONVERSATION_GUARD_ENABLED` (default `true`)
- Skip for commitment follow-ups (check `triggerType`)

**DO NOT** replace the existing guard chain. Add to it.

---

### Step 7: Modify `src/engine/proactive/proactive-runner.ts`

Integrate new features into the existing BullMQ runner.

**Smart cooldown integration:**

- Before running a job, check `getCooldownState()`
- If `nextCheckAt` is in the future, skip this run
- After job completes, call `updateCooldownState()` with the outcome

**Orphan recovery job type:**

- Register as a new BullMQ repeatable job
- Default interval: 5 minutes
- Handler calls `findOrphanMessages()` and re-dispatches each via `registry.runHook('message:incoming', ...)`

**Configure all new features from `proactive.json`** (extend existing config structure).

---

### Step 8: Update `instance/proactive.json`

Add new configuration sections:

```json
{
  "smart_cooldown": {
    "enabled": true,
    "after_sent_minutes": 30,
    "after_no_action_minutes": 60,
    "after_error_minutes": 10,
    "max_backoff_hours": 24
  },
  "orphan_recovery": {
    "enabled": true,
    "interval_minutes": 5,
    "lookback_minutes": 30,
    "max_per_run": 10
  },
  "conversation_guard": {
    "enabled": true,
    "cache_ttl_hours": 6,
    "skip_for_commitments": true
  }
}
```

These sections are added alongside existing proactive configuration. Existing fields are preserved.

---

### Step 9: Update `src/engine/proactive/CLAUDE.md` (or create if not exists)

Document:

- Smart cooldown system (adaptive timing, Redis storage, backoff logic)
- Orphan recovery mechanism (detection query, re-dispatch flow, grace period)
- Conversation guard (goodbye detection, Redis cache, skip rules)
- How they integrate with existing guards and BullMQ jobs
- Configuration via `proactive.json`

---

### Step 10: Update `src/modules/tools/CLAUDE.md`

Document:

- Two-tier description system (`shortDescription` vs `detailedGuidance`)
- How tools are declared to the LLM (short descriptions, token-efficient)
- How guidance is injected on tool invocation (detailed, context-rich)
- How `tool-converter.ts` uses `shortDescription` in native formats
- Backward compatibility: tools without `shortDescription` fall back to `description`

---

## Files Created/Modified Summary

**NEW files:**

| File | Purpose |
|------|---------|
| `src/engine/proactive/smart-cooldown.ts` | Adaptive cooldown per contact+trigger using Redis |
| `src/engine/proactive/orphan-recovery.ts` | Detect and re-dispatch unanswered messages |
| `src/engine/proactive/conversation-guard.ts` | Suppress outreach when contact said goodbye |
| `src/engine/concurrency/execution-queue.ts` | Priority-based queue with reactive/proactive/background lanes |

**MODIFIED files:**

| File | Change |
|------|--------|
| `src/modules/tools/types.ts` | Add `shortDescription`, `detailedGuidance` to `ToolDefinition` |
| `src/modules/tools/tool-registry.ts` | Two-tier support: auto-generate short, expose guidance method |
| `src/modules/tools/tool-converter.ts` | Use `shortDescription` in native tool definitions |
| `src/engine/proactive/guards.ts` | Add conversation guard as guard #8 |
| `src/engine/proactive/proactive-runner.ts` | Integrate smart cooldown and orphan recovery job |
| `instance/proactive.json` | Add smart_cooldown, orphan_recovery, conversation_guard config |
| `src/engine/proactive/CLAUDE.md` | Document new proactive features |
| `src/modules/tools/CLAUDE.md` | Document two-tier description system |

---

## Acceptance Criteria

1. All files compile with `npx tsc --noEmit`
2. `ToolDefinition` now supports `shortDescription` and `detailedGuidance`
3. Tool converter uses `shortDescription` in native formats (Anthropic, Gemini)
4. Smart cooldown stores state in Redis with adaptive timing
5. Orphan recovery finds unanswered messages via SQL query on `messages` table
6. Conversation guard detects goodbye patterns and caches in Redis
7. Execution queue prioritizes reactive > proactive > background
8. All new features are configurable via `proactive.json`
9. NO new DB tables created
10. NO new registry services created
11. Existing `guards.ts` chain is extended, not replaced
12. Existing `proactive-runner.ts` is extended, not replaced

---

## Dependency Notes

- This instance has NO hard dependencies on other instances
- Instance 1 (agentic loop) will CONSUME `getToolGuidance()` to inject guidance into tool results
- Instance 2 (prompts) will CONSUME `getCatalog()` with short descriptions for the system prompt
- The execution queue will be wired into the main pipeline by Instance 4 (integration)
- Smart cooldown and orphan recovery run independently via BullMQ and don't require other instances
