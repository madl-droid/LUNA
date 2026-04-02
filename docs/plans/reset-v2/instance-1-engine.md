# Instance 1 — Agentic Loop Engine

> **Branch**: `reset/instance-1-engine` (from `reset`)
> **LLM**: opusplan
> **Parallel**: Yes (runs alongside Instance 2 and Instance 3)
> **Scope**: Replace Phases 2+3+4 with a single agentic loop

---

## Pre-flight: Read Before Writing Anything

Read every file listed below in full. Do not begin Step 1 until you have read all of them and understand the types, function signatures, and patterns.

### Plans (understand the big picture)
- `/docker/luna-repo/docs/plans/reset-v2/overview.md`
- `/docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md`

### Engine core (understand the orchestrator you are extending)
- `/docker/luna-repo/src/engine/engine.ts` — main orchestrator, 5-phase pipeline, concurrency layers
- `/docker/luna-repo/src/engine/types.ts` — ALL types: ContextBundle, LLMCallOptions, LLMCallResult, LLMToolDef, CompositorOutput, PipelineResult, EngineConfig, ToolResult, ToolDefinition
- `/docker/luna-repo/src/engine/config.ts` — loadEngineConfig(), env var defaults

### LLM client (you MUST use this, not create your own)
- `/docker/luna-repo/src/engine/utils/llm-client.ts` — callLLM(), callLLMWithFallback(), setLLMGateway()

### Phases being replaced (understand what you are replacing)
- `/docker/luna-repo/src/engine/phases/phase2-evaluate.ts` — intent classification, execution plan generation
- `/docker/luna-repo/src/engine/phases/phase3-execute.ts` — step router, tool execution, StepSemaphore usage
- `/docker/luna-repo/src/engine/phases/phase4-compose.ts` — response composition, criticizer, TTS, formatForChannel

### Tool system (you MUST use this for all tool execution)
- `/docker/luna-repo/src/modules/tools/tool-registry.ts` — ToolRegistry class: registerTool, executeTool, getEnabledToolDefinitions, isToolAllowed
- `/docker/luna-repo/src/modules/tools/tool-converter.ts` — toNativeTools(), toAnthropicTools(), toGeminiTools()
- `/docker/luna-repo/src/modules/tools/types.ts` — ToolDefinition (full shape with displayName, sourceModule, category), ToolResult (toolName, success, data, error, durationMs, retries), ToolExecutionContext

### Subagent (you will modify this)
- `/docker/luna-repo/src/engine/subagent/subagent.ts` — runSubagentV2(), runSubagentLoop() pattern, tool execution inside loop
- `/docker/luna-repo/src/engine/subagent/types.ts` — SubagentRunConfig, SubagentGuardrails, SUBAGENT_HARD_LIMITS

### Concurrency (reuse for tool parallelism)
- `/docker/luna-repo/src/engine/concurrency/step-semaphore.ts` — StepSemaphore class with acquire/release/run pattern

### Formatting utilities
- `/docker/luna-repo/src/engine/utils/message-formatter.ts` — formatForChannel(text, channel, registry?)
- `/docker/luna-repo/src/engine/utils/prompt-escape.ts` — escapeForPrompt(), wrapUserContent(), escapeDataForPrompt()

---

## Step 0: Setup

### 0.1 Create Branch

```bash
cd /docker/luna-repo
git checkout reset
git pull origin reset
git checkout -b reset/instance-1-engine
```

### 0.2 Create Directory

```bash
mkdir -p src/engine/agentic
```

### 0.3 Verify Read

Confirm you have read every file from the Pre-flight list. If you skipped any, read it now.

---

## Step 1: Create `src/engine/agentic/types.ts`

Define all types for the agentic loop. These are internal to `src/engine/agentic/` and must NOT duplicate any types from `engine/types.ts`.

### Types to define

```typescript
// src/engine/agentic/types.ts

import type { LLMProvider } from '../types.js'

/**
 * Effort level determines which model handles the message.
 * Classified deterministically (no LLM call) by effort-router.ts.
 */
export type EffortLevel = 'low' | 'medium' | 'high'

/**
 * Agentic loop configuration.
 * Assembled by the engine from EngineConfig values — NOT a new config source.
 * The engine (Instance 4) will construct this from EngineConfig fields.
 */
export interface AgenticConfig {
  /** Max tool-calling turns before forcing a text response */
  maxToolTurns: number
  /** Max concurrent tool executions within a single turn (reuses StepSemaphore) */
  maxConcurrentTools: number
  /** Effort level for this pipeline run (determines model selection) */
  effort: EffortLevel
  /** Primary model name (resolved from effort level) */
  model: string
  /** Primary provider (resolved from effort level) */
  provider: LLMProvider
  /** Fallback model name */
  fallbackModel: string
  /** Fallback provider */
  fallbackProvider: LLMProvider
  /** Temperature for responses */
  temperature: number
  /** Max output tokens per LLM call */
  maxOutputTokens: number
  /** Criticizer mode: 'disabled' | 'complex_only' | 'always' */
  criticizerMode: 'disabled' | 'complex_only' | 'always'
}

/**
 * Record of a single tool call within the agentic loop.
 */
export interface ToolCallLog {
  /** Tool name */
  name: string
  /** Input parameters passed to the tool */
  input: Record<string, unknown>
  /** Output from the tool (ToolResult.data) */
  output: unknown
  /** Whether the tool call succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Wall-clock duration in ms */
  durationMs: number
  /** Whether result came from dedup cache */
  fromCache: boolean
  /** Whether the call was blocked by loop detector */
  blocked?: boolean
  /** Reason for blocking (from loop detector) */
  blockReason?: string
}

/**
 * Output of the agentic loop (runAgenticLoop).
 * This is an intermediate result; post-processor converts it to CompositorOutput.
 */
export interface AgenticResult {
  /** Final response text from the LLM */
  responseText: string
  /** Log of every tool call made during the loop */
  toolCallsLog: ToolCallLog[]
  /** Number of LLM turns (each turn = one callLLM invocation) */
  turns: number
  /** Total tokens consumed (input + output across all turns) */
  tokensUsed: number
  /** Effort level used for this run */
  effortUsed: EffortLevel
  /** Partial text if the loop was cut short (timeout or turn limit) */
  partialText?: string
  /** Names of all tools called (deduplicated, for pipeline log) */
  toolsUsed: string[]
}

/**
 * Loop detector action. Graduated response to repetitive tool calls.
 */
export type LoopAction = 'allow' | 'warn' | 'block' | 'circuit_break'

/**
 * Result from the loop detector check.
 */
export interface LoopDetectorResult {
  action: LoopAction
  reason?: string
}

/**
 * Internal tracking entry for the loop detector.
 */
export interface LoopCallEntry {
  toolName: string
  inputHash: string
  resultHash: string
  timestamp: number
}
```

### Constraints

- Import only from `../types.js` (for `LLMProvider`). No other imports.
- Do NOT redefine `ToolResult`, `ToolDefinition`, `LLMCallOptions`, `LLMCallResult`, `LLMToolDef`, `CompositorOutput`, `ContextBundle`, or `EngineConfig`. Those live in `engine/types.ts` and are used as-is.
- Do NOT import from `modules/` — the agentic loop is part of the engine, not a module.
- Every type must have JSDoc comments.

---

## Step 2: Create `src/engine/agentic/effort-router.ts`

Classify incoming messages by complexity. This is pure deterministic code, no LLM call.

### Function signature

```typescript
import type { ContextBundle } from '../types.js'
import type { EffortLevel } from './types.js'

/**
 * Classify message complexity to route to the appropriate model tier.
 * Must complete in <5ms. No LLM calls, no async, no I/O.
 *
 * - 'low': greetings, thanks, simple acknowledgments -> cheap model (Haiku/Flash)
 * - 'medium': questions, information requests, single-tool tasks -> standard model (Sonnet)
 * - 'high': objections, multi-step requests, complex reasoning -> capable model (Sonnet/Opus)
 */
export function classifyEffort(ctx: ContextBundle): EffortLevel
```

### Classification logic (deterministic rules, evaluated in order)

**Return `'high'` if ANY of these are true:**
1. `ctx.normalizedText` length > 500 characters (complex message)
2. `ctx.normalizedText` contains 3+ question marks (multi-question)
3. `ctx.attachmentMeta.length >= 2` (multiple attachments need reasoning)
4. `ctx.pendingCommitments.length > 0` AND message references time/dates (commitment follow-up)
5. `ctx.hitlPendingContext` is non-null (HITL context requires careful handling)
6. Message contains objection keywords: `['no me interesa', 'muy caro', 'es mucho', 'no puedo', 'competencia', 'otro proveedor', 'lo pensaré', 'no estoy seguro', 'cancelar', 'devolver']` (case-insensitive substring match)
7. `ctx.isNewContact` is true AND message length > 200 (new contact with complex first message)

**Return `'low'` if ANY of these are true (and none of the 'high' rules matched):**
1. `ctx.normalizedText` length < 30 characters (short message)
2. Message matches greeting patterns: `/^(hola|hey|buenas?|buenos?\s+(d[ií]as?|tardes?|noches?)|hi|hello|que tal|qué tal)\b/i`
3. Message matches thanks patterns: `/^(gracias|thanks|thank you|ok|okay|listo|perfecto|genial|dale|va|bien|entendido|claro)\b/i`
4. Message is a single emoji or sticker (`ctx.messageType === 'sticker'` or text matches `/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u`)

**Otherwise return `'medium'`.**

### Implementation notes

- Use a single function, no classes. Pure function.
- Pre-compile regex patterns as module-level constants (not inside the function).
- The objection keywords list should be a `const` array at module level for easy maintenance.
- Return type is `EffortLevel` (imported from `./types.js`).
- Do NOT import from `modules/` or access registry. This function only reads the ContextBundle.

---

## Step 3: Create `src/engine/agentic/tool-dedup-cache.ts`

In-memory cache that prevents identical tool calls within a single pipeline run.

### Class design

```typescript
import type { ToolCallLog } from './types.js'

/**
 * Per-pipeline dedup cache for tool calls.
 * Lifecycle: create at loop start, discard after loop ends. No Redis, no persistence.
 *
 * Skips caching for write operations (tools that have side effects).
 */
export class ToolDedupCache {
  /** Set of tool names that should never be cached (write operations). */
  private static readonly WRITE_TOOLS: ReadonlySet<string> = new Set([
    'create_commitment',
    'send_email',
    'create_event',
    'update_event',
    'delete_event',
    'create_contact',
    'update_contact',
    'write_sheet',
    'update_sheet',
    'create_ticket',
    'update_ticket',
    'escalate_to_human',
    'spawn_subagent',
    'schedule_follow_up',
  ])

  private cache = new Map<string, { data: unknown; success: boolean; error?: string; durationMs: number }>()

  /**
   * Build the cache key: hash of tool name + serialized input.
   */
  private buildKey(toolName: string, input: Record<string, unknown>): string

  /**
   * Check if a cached result exists for this tool call.
   * Returns null if not cached or if the tool is a write operation.
   */
  get(toolName: string, input: Record<string, unknown>): { data: unknown; success: boolean; error?: string; durationMs: number } | null

  /**
   * Store a tool result in the cache.
   * No-op for write operations.
   */
  set(toolName: string, input: Record<string, unknown>, result: { data: unknown; success: boolean; error?: string; durationMs: number }): void

  /**
   * Number of cached entries (for logging).
   */
  get size(): number
}
```

### Implementation notes

- `buildKey`: Use `toolName + ':' + JSON.stringify(input)` as the key. No need for a cryptographic hash; the Map handles arbitrary string keys efficiently. If input is large (>10KB serialized), truncate the key to 10KB.
- `get`: Return `null` if `WRITE_TOOLS.has(toolName)` or if key is not in cache.
- `set`: No-op if `WRITE_TOOLS.has(toolName)`. Otherwise, `this.cache.set(key, result)`.
- The WRITE_TOOLS set can be extended later. Keep it as a static readonly property so it is easy to find and update.
- Do NOT import from `modules/`. The write-tool list is a static allowlist maintained here.

---

## Step 4: Create `src/engine/agentic/tool-loop-detector.ts`

Detect and prevent infinite tool call loops. Uses three detection strategies with graduated thresholds.

### Class design

```typescript
import type { LoopDetectorResult, LoopCallEntry } from './types.js'

/**
 * Detects and prevents infinite tool call loops within the agentic loop.
 *
 * Three detectors (inspired by OpenClaw patterns):
 * 1. Generic Repeat: same tool + same input called N times
 * 2. No-Progress: same tool called with changing input but identical result hashes
 * 3. Ping-Pong: alternating between 2 tools repeatedly
 *
 * Graduated thresholds:
 * - warn (3): log warning, continue execution
 * - block (5): block that specific tool, inject error to LLM
 * - circuit_break (8): stop ALL tool calls, force text response
 */
export class ToolLoopDetector {
  private history: LoopCallEntry[] = []

  /** Names of tools that have been individually blocked. */
  private blockedTools = new Set<string>()

  /** Whether the circuit breaker has tripped (all tools blocked). */
  private circuitBroken = false

  // ── Thresholds (constants) ──

  private static readonly WARN_THRESHOLD = 3
  private static readonly BLOCK_THRESHOLD = 5
  private static readonly CIRCUIT_BREAK_THRESHOLD = 8

  /**
   * Record a tool call and check for loop patterns.
   *
   * @param toolName - Name of the tool being called
   * @param input - Input parameters (will be hashed for comparison)
   * @param resultData - Output data from the tool (will be hashed for no-progress detection)
   * @returns LoopDetectorResult with action and optional reason
   */
  check(toolName: string, input: Record<string, unknown>, resultData?: unknown): LoopDetectorResult

  /**
   * Pre-check before executing a tool. Returns 'block' if the tool is individually
   * blocked, or 'circuit_break' if all tools are blocked.
   * Does NOT record anything — call check() after execution.
   */
  preCheck(toolName: string): LoopDetectorResult

  /**
   * Returns true if the circuit breaker has tripped (all tools blocked).
   */
  get isCircuitBroken(): boolean
}
```

### Detection logic inside `check()`

```
1. Build inputHash from JSON.stringify(input) (first 2000 chars)
2. Build resultHash from JSON.stringify(resultData) (first 2000 chars), or 'void' if undefined
3. Push { toolName, inputHash, resultHash, timestamp: Date.now() } to this.history
4. Count: how many times has this exact (toolName + inputHash) appeared?
   - If count >= CIRCUIT_BREAK_THRESHOLD: set this.circuitBroken = true, return { action: 'circuit_break', reason }
   - If count >= BLOCK_THRESHOLD: add toolName to this.blockedTools, return { action: 'block', reason }
   - If count >= WARN_THRESHOLD: return { action: 'warn', reason }
5. No-progress check: look at last 5 calls to this toolName. If all have different inputHash but same resultHash:
   - If 5+ calls: return { action: 'block', reason: 'No progress detected' }
   - If 3+ calls: return { action: 'warn', reason: 'Possible no-progress loop' }
6. Ping-pong check: look at last 6 entries in history. If they alternate between exactly 2 tools (ABABAB):
   - return { action: 'warn', reason: 'Ping-pong pattern detected between toolA and toolB' }
   - If 8+ alternating: return { action: 'circuit_break', reason }
7. Return { action: 'allow' }
```

### `preCheck()` logic

```
1. If this.circuitBroken: return { action: 'circuit_break', reason: 'Circuit breaker active — all tools blocked' }
2. If this.blockedTools.has(toolName): return { action: 'block', reason: `Tool "${toolName}" blocked due to repeated calls` }
3. Return { action: 'allow' }
```

### Implementation notes

- Use simple string comparison for hashes. `JSON.stringify` is deterministic for the same input shape.
- Keep `this.history` unbounded within a single pipeline run (tool calls are capped by maxToolTurns anyway, so this array will not grow beyond ~40 entries max even in pathological cases: 5 tools per turn * 8 turns).
- Do NOT import from `modules/`. This is pure engine code.
- Log warnings at the 'warn' level using pino: `import pino from 'pino'; const logger = pino({ name: 'engine:loop-detector' })`.

---

## Step 5: Create `src/engine/agentic/agentic-loop.ts` -- THE CORE

This is the heart of the v2 engine. It replaces Phases 2+3+4 with a single LLM conversation that has native tool access.

### Function signature

```typescript
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  LLMCallOptions,
  LLMCallResult,
  LLMToolDef,
  LLMProvider,
} from '../types.js'
import type { AgenticConfig, AgenticResult, ToolCallLog } from './types.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import { StepSemaphore } from '../concurrency/step-semaphore.js'
import { ToolDedupCache } from './tool-dedup-cache.js'
import { ToolLoopDetector } from './tool-loop-detector.js'

const logger = pino({ name: 'engine:agentic' })

/**
 * Tool registry interface — only the methods we need.
 * Avoids importing the full ToolRegistry class from modules/.
 */
interface ToolExecutor {
  executeTool(
    name: string,
    input: Record<string, unknown>,
    context: { contactId?: string | null; agentId?: string; traceId?: string; messageId?: string; contactType?: string | null },
  ): Promise<{ toolName: string; success: boolean; data?: unknown; error?: string; durationMs: number; retries: number }>
}

/**
 * Run the agentic loop: LLM + native tool calling until the model produces a final text response.
 *
 * @param ctx - ContextBundle from Phase 1 (unchanged)
 * @param systemPrompt - Fully assembled system prompt (built by Instance 2's prompt builder)
 * @param toolDefinitions - Native-format tool definitions for the LLM (from tool registry, already converted)
 * @param config - AgenticConfig with model, effort, limits
 * @param registry - Kernel registry for service access
 * @returns AgenticResult with responseText, tool call log, token usage
 */
export async function runAgenticLoop(
  ctx: ContextBundle,
  systemPrompt: string,
  toolDefinitions: LLMToolDef[],
  config: AgenticConfig,
  registry: Registry,
): Promise<AgenticResult>
```

### Internal implementation — step by step

#### 5.1 Initialize state

```typescript
const startMs = Date.now()
const dedupCache = new ToolDedupCache()
const loopDetector = new ToolLoopDetector()
const toolCallsLog: ToolCallLog[] = []
let totalTokens = 0
let turns = 0
let partialText = '' // accumulates any text the LLM produces alongside tool calls
```

#### 5.2 Get tool executor from registry

```typescript
const toolExecutor = registry.getOptional<ToolExecutor>('tools:registry')
// If no tool executor, clear tool definitions — LLM will respond text-only
const effectiveTools = toolExecutor ? toolDefinitions : []
```

#### 5.3 Build initial messages array

```typescript
// The messages array uses the Anthropic multi-turn format.
// Tool use/result are modeled as content blocks within messages.
// However, callLLM() in llm-client.ts currently takes string content.
// We use string content for the initial user message and handle
// tool_use/tool_result through the message flow.

const messages: LLMCallOptions['messages'] = [
  { role: 'user', content: ctx.normalizedText },
]
```

**Important**: The user message is `ctx.normalizedText`. Attachment context is already injected into history by Phase 1 (see engine CLAUDE.md: "Inyecta cada adjunto como mensaje en ctx.history"). The system prompt (built by Instance 2) includes conversation history from `ctx.history`. The agentic loop only needs the current message as the user turn.

#### 5.4 Enter the loop

```typescript
while (turns < config.maxToolTurns) {
  turns++

  // 5.4.1 — Check circuit breaker before calling LLM
  if (loopDetector.isCircuitBroken) {
    logger.warn({ traceId: ctx.traceId, turns }, 'Circuit breaker active — forcing text response')
    // Make one final LLM call WITHOUT tools to get a text response
    break // fall through to final-text-only call below
  }

  // 5.4.2 — Call LLM
  const llmResult = await callLLMWithFallback(
    {
      task: 'agentic',
      provider: config.provider,
      model: config.model,
      system: systemPrompt,
      messages,
      maxTokens: config.maxOutputTokens,
      temperature: config.temperature,
      tools: effectiveTools.length > 0 ? effectiveTools : undefined,
    },
    config.fallbackProvider,
    config.fallbackModel,
  )

  totalTokens += llmResult.inputTokens + llmResult.outputTokens

  // 5.4.3 — No tool calls: LLM is done. Return text.
  if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
    const responseText = llmResult.text || partialText
    return buildResult(responseText, toolCallsLog, turns, totalTokens, config.effort)
  }

  // 5.4.4 — Has tool calls: execute them
  // Capture any text the LLM produced alongside tool calls (partial reasoning)
  if (llmResult.text) {
    partialText = llmResult.text
  }

  // Build the assistant message with tool_use blocks (for conversation history)
  // and execute each tool call
  const toolResults = await executeToolCalls(
    llmResult.toolCalls,
    ctx,
    toolExecutor!,     // non-null because effectiveTools.length > 0
    dedupCache,
    loopDetector,
    toolCallsLog,
    config,
  )

  // 5.4.5 — Append assistant message (with tool calls) and user message (with results) to conversation
  // The assistant message content is: the LLM's text (if any) + a marker for each tool call
  // The user message content is: tool results
  messages.push({
    role: 'assistant',
    content: formatAssistantToolMessage(llmResult.text, llmResult.toolCalls),
  })
  messages.push({
    role: 'user',
    content: formatToolResultsMessage(toolResults),
  })
}
```

#### 5.5 Handle turn limit exceeded or circuit breaker

If the loop exits because `turns >= config.maxToolTurns` or the circuit breaker tripped, make one final LLM call WITHOUT tools to force a text response.

```typescript
// Force a text-only response
logger.info({ traceId: ctx.traceId, turns, reason: loopDetector.isCircuitBroken ? 'circuit_break' : 'turn_limit' },
  'Forcing text response')

messages.push({
  role: 'user',
  content: 'You have reached the tool call limit. Please provide your final response now using the information you have gathered so far. Do not attempt any more tool calls.',
})

const finalResult = await callLLMWithFallback(
  {
    task: 'agentic',
    provider: config.provider,
    model: config.model,
    system: systemPrompt,
    messages,
    maxTokens: config.maxOutputTokens,
    temperature: config.temperature,
    // NO tools parameter — forces text-only response
  },
  config.fallbackProvider,
  config.fallbackModel,
)

totalTokens += finalResult.inputTokens + finalResult.outputTokens
const responseText = finalResult.text || partialText

return buildResult(responseText, toolCallsLog, turns, totalTokens, config.effort, partialText || undefined)
```

#### 5.6 Tool execution helper (internal function)

```typescript
/**
 * Execute a batch of tool calls from a single LLM turn.
 * Uses StepSemaphore for parallelism, dedup cache, and loop detection.
 */
async function executeToolCalls(
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  ctx: ContextBundle,
  toolExecutor: ToolExecutor,
  dedupCache: ToolDedupCache,
  loopDetector: ToolLoopDetector,
  toolCallsLog: ToolCallLog[],
  config: AgenticConfig,
): Promise<Array<{ name: string; success: boolean; data: unknown; error?: string }>>
```

**Logic for each tool call** (executed in parallel via `StepSemaphore.run()`):

```
1. Pre-check with loop detector:
   - const preCheck = loopDetector.preCheck(toolCall.name)
   - If preCheck.action === 'block' or 'circuit_break':
     - Log to toolCallsLog with blocked: true, blockReason: preCheck.reason
     - Return { name, success: false, data: null, error: preCheck.reason }

2. Check dedup cache:
   - const cached = dedupCache.get(toolCall.name, toolCall.input)
   - If cached:
     - Log to toolCallsLog with fromCache: true
     - return { name, success: cached.success, data: cached.data, error: cached.error }

3. Execute via tool registry:
   - const result = await toolExecutor.executeTool(toolCall.name, toolCall.input, {
       contactId: ctx.contactId,
       agentId: ctx.agentId,
       traceId: ctx.traceId,
       messageId: ctx.message.id,
       contactType: ctx.contact?.contactType ?? null,
     })

4. Store in dedup cache:
   - dedupCache.set(toolCall.name, toolCall.input, {
       data: result.data, success: result.success, error: result.error, durationMs: result.durationMs,
     })

5. Post-check with loop detector:
   - loopDetector.check(toolCall.name, toolCall.input, result.data)

6. Log to toolCallsLog:
   - Push { name, input, output: result.data, success: result.success, error: result.error,
       durationMs: result.durationMs, fromCache: false }

7. Return { name, success: result.success, data: result.data, error: result.error }
```

Create a `StepSemaphore(config.maxConcurrentTools)` at the start of `executeToolCalls`, then wrap each tool call in `semaphore.run(async () => { ... })`. Collect results with `Promise.allSettled()` and handle rejected promises as errors.

#### 5.7 Message formatting helpers (internal functions)

```typescript
/**
 * Format the assistant's response that contains tool calls for the conversation history.
 * The LLM gateway handles the actual tool_use blocks in the API call.
 * For the conversation messages array, we represent tool calls as structured text
 * so the LLM can track what it did.
 */
function formatAssistantToolMessage(
  text: string | undefined,
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
): string {
  const parts: string[] = []
  if (text) parts.push(text)
  for (const tc of toolCalls) {
    parts.push(`[Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 500)})]`)
  }
  return parts.join('\n')
}

/**
 * Format tool results as a user message for the conversation.
 */
function formatToolResultsMessage(
  results: Array<{ name: string; success: boolean; data: unknown; error?: string }>,
): string {
  const parts: string[] = ['Tool results:']
  for (const r of results) {
    if (r.success) {
      const dataStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
      parts.push(`[${r.name}]: ${(dataStr ?? '(no data)').slice(0, 3000)}`)
    } else {
      parts.push(`[${r.name}]: ERROR — ${r.error ?? 'Unknown error'}`)
    }
  }
  return parts.join('\n\n')
}
```

#### 5.8 Result builder (internal function)

```typescript
function buildResult(
  responseText: string,
  toolCallsLog: ToolCallLog[],
  turns: number,
  tokensUsed: number,
  effortUsed: EffortLevel,
  partialText?: string,
): AgenticResult {
  const toolsUsed = [...new Set(toolCallsLog.filter(t => !t.blocked).map(t => t.name))]
  return {
    responseText,
    toolCallsLog,
    turns,
    tokensUsed,
    effortUsed,
    partialText,
    toolsUsed,
  }
}
```

### Error handling

- If `callLLMWithFallback()` throws inside the loop, catch the error. If `partialText` exists, return it as the response with what was gathered. If no text at all, re-throw so the engine's error handler sends a fallback message.
- If a single tool execution throws (not just returns `success: false`), catch it within `executeToolCalls`, log the error, and return `{ success: false, error: String(err) }` for that tool. The loop continues.
- Wrap the entire loop body in try/catch. Log at `logger.error` level on unexpected exceptions.

### What this file must NOT do

- Do NOT import from `src/modules/` — only use the `ToolExecutor` interface defined locally.
- Do NOT build the system prompt — that is Instance 2's responsibility. The prompt arrives as a parameter.
- Do NOT call `formatForChannel()` — that is the post-processor's job.
- Do NOT handle TTS — that is the post-processor's job.
- Do NOT create new registry services.
- Do NOT modify `engine/types.ts` or `engine/config.ts` — Instance 4 does that.

---

## Step 6: Create `src/engine/agentic/post-processor.ts`

Post-processing after the agentic loop produces text. Converts `AgenticResult` into `CompositorOutput`.

### Function signature

```typescript
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, CompositorOutput, EngineConfig } from '../types.js'
import type { AgenticResult } from './types.js'
import { callLLM } from '../utils/llm-client.js'
import { formatForChannel } from '../utils/message-formatter.js'

const logger = pino({ name: 'engine:post-processor' })

/**
 * TTS service interface — only the methods we need.
 */
interface TTSServiceLike {
  shouldAutoTTS(channel: string, inputType: string): boolean
  shouldAutoTTSWithMultiplier(channel: string, inputType: string, multiplier: number): boolean
  synthesize(text: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
  synthesizeChunks(text: string): Promise<Array<{ audioBuffer: Buffer; durationSeconds: number }>>
  isEnabledForChannel(channel: string): boolean
}

/**
 * Convert AgenticResult into CompositorOutput.
 *
 * Steps:
 * 1. Criticizer (optional, only for complex messages)
 * 2. Channel formatting
 * 3. TTS (if audio response)
 *
 * @param agenticResult - Output from runAgenticLoop
 * @param ctx - ContextBundle from Phase 1
 * @param config - EngineConfig (for criticizer mode, model selection)
 * @param registry - Kernel registry
 * @returns CompositorOutput (reused type from engine/types.ts)
 */
export async function postProcess(
  agenticResult: AgenticResult,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
): Promise<CompositorOutput>
```

### Implementation logic

#### 6.1 Criticizer (smart mode)

```typescript
let responseText = agenticResult.responseText

// Determine if criticizer should run
const shouldCriticize =
  config.criticizerMode === 'always' ||
  (config.criticizerMode === 'complex_only' && (
    agenticResult.effortUsed === 'high' ||
    agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= 3
  ))

if (shouldCriticize && responseText.length > 50) {
  try {
    const criticized = await runCriticizer(responseText, ctx, config, registry)
    if (criticized) {
      responseText = criticized
    }
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Criticizer failed — using original response')
  }
}
```

#### 6.2 Criticizer implementation (internal function)

```typescript
/**
 * Run the criticizer: ask a fast model to review and optionally improve the response.
 * Reuses the pattern from phase4-compose.ts but as a focused function.
 *
 * Returns improved text, or null if the original is fine.
 */
async function runCriticizer(
  responseText: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
): Promise<string | null> {
  // Load criticizer prompt from prompts:service if available
  const promptsService = registry.getOptional<{ getPrompt(slot: string, variant?: string): Promise<string> }>('prompts:service')
  const criticizerPrompt = promptsService
    ? await promptsService.getPrompt('criticizer').catch(() => null)
    : null

  const system = criticizerPrompt || `You are a quality reviewer for a sales agent's response. Review the response for:
1. Accuracy — does it answer the question?
2. Tone — is it professional and warm?
3. Completeness — is anything missing?
4. Brevity — is it unnecessarily long?

If the response is good, reply with exactly: APPROVED
If it needs changes, reply with the improved response directly (no explanation, no preamble).`

  const result = await callLLM({
    task: 'criticizer',
    provider: config.classifyProvider,
    model: config.classifyModel,
    system,
    messages: [
      {
        role: 'user',
        content: `User message: ${ctx.normalizedText.slice(0, 500)}\n\nAgent response to review:\n${responseText}`,
      },
    ],
    maxTokens: config.maxOutputTokens,
    temperature: 0.2,
  })

  const critText = result.text.trim()
  if (critText === 'APPROVED' || critText.length < 10) {
    return null // Original is fine
  }
  return critText
}
```

#### 6.3 Channel formatting

```typescript
const formattedParts = formatForChannel(responseText, ctx.message.channelName, registry)
```

#### 6.4 TTS

Replicate the TTS logic from `phase4-compose.ts`:

```typescript
let audioBuffer: Buffer | undefined
let audioDurationSeconds: number | undefined
let audioChunks: Array<{ audioBuffer: Buffer; durationSeconds: number }> | undefined
let outputFormat: 'text' | 'audio' = 'text'
let ttsFailed = false

const ttsService = registry.getOptional<TTSServiceLike>('tts:service') ?? null

let shouldTTS = false
if (ctx.responseFormat === 'audio') {
  shouldTTS = ttsService?.isEnabledForChannel(ctx.message.channelName) ?? false
} else if (ctx.responseFormat === 'auto' && ttsService) {
  shouldTTS = ttsService.shouldAutoTTS(ctx.message.channelName, ctx.messageType)
}

if (shouldTTS && ttsService) {
  try {
    // For long responses, use chunked synthesis (multiple voice notes)
    if (responseText.length > 900) {
      const chunks = await ttsService.synthesizeChunks(responseText)
      if (chunks.length > 0) {
        audioChunks = chunks
        audioBuffer = chunks[0]!.audioBuffer
        audioDurationSeconds = chunks[0]!.durationSeconds
        outputFormat = 'audio'
      }
    } else {
      const result = await ttsService.synthesize(responseText)
      if (result) {
        audioBuffer = result.audioBuffer
        audioDurationSeconds = result.durationSeconds
        outputFormat = 'audio'
      }
    }
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'TTS synthesis failed')
    ttsFailed = true
  }
}
```

#### 6.5 Build and return CompositorOutput

```typescript
return {
  responseText,
  formattedParts,
  audioBuffer,
  audioDurationSeconds,
  audioChunks,
  outputFormat,
  ttsFailed: ttsFailed || undefined,
}
```

### What this file must NOT do

- Do NOT duplicate the full criticizer prompt builder from `prompts/compositor.ts`. Use `prompts:service.getPrompt('criticizer')` if available, fall back to a simple inline prompt.
- Do NOT call `callLLMWithFallback` for the criticizer — it is non-critical. Use `callLLM` directly. If it fails, the original response is used.
- Do NOT create new registry services.

---

## Step 7: Modify `src/engine/subagent/subagent.ts` -- Fresh Context

Modify `runSubagentV2()` to give subagents a clean-slate context instead of the parent's full ContextBundle.

### What to change

Add a new internal function `buildSubagentContext()` and call it at the start of `runSubagentV2()`.

#### 7.1 Add the helper function (after the imports, before `resolveRunConfig`)

```typescript
/**
 * Build a minimal context for subagent execution.
 * Keeps identity and permissions but strips history, knowledge matches,
 * buffer summary, and relevant summaries to prevent context bloat.
 * The subagent gets a clean slate focused on its specific task.
 */
function buildSubagentContext(parentCtx: ContextBundle, taskDescription: string): ContextBundle {
  return {
    // Original message — keep for traceId and channel info
    message: parentCtx.message,
    traceId: parentCtx.traceId,

    // Identity — keep all
    userType: parentCtx.userType,
    userPermissions: parentCtx.userPermissions,
    contactId: parentCtx.contactId,
    agentId: parentCtx.agentId,

    // Contact & session — keep for identity context
    contact: parentCtx.contact,
    session: parentCtx.session,
    isNewContact: parentCtx.isNewContact,

    // Campaign — keep (may be relevant to subagent task)
    campaign: parentCtx.campaign,

    // RAG and knowledge — STRIP (subagent searches its own if needed)
    knowledgeMatches: [],
    knowledgeInjection: null,
    freshdeskMatches: [],

    // Assignment rules — STRIP
    assignmentRules: null,

    // History — STRIP (clean slate)
    history: [],

    // Buffer summary — STRIP
    bufferSummary: null,

    // Memory — STRIP (subagent can use tools to query memory if needed)
    contactMemory: null,
    pendingCommitments: [],
    relevantSummaries: [],
    leadStatus: parentCtx.leadStatus,

    // Sheets — STRIP
    sheetsData: null,

    // Normalized text — replace with task description
    normalizedText: taskDescription,
    messageType: 'text',

    // Response format — always text for subagents
    responseFormat: 'text',

    // Attachments — STRIP (subagent doesn't process parent's attachments)
    attachmentMeta: [],
    attachmentContext: null,

    // Injection — inherit from parent
    possibleInjection: parentCtx.possibleInjection,

    // HITL — STRIP
    hitlPendingContext: null,
  }
}
```

#### 7.2 Modify `runSubagentV2()` to use it

In the `runSubagentV2()` function, after the catalog entry is resolved and before calling `runSubagentLoop()`, replace the `ctx` parameter:

```typescript
// Build minimal context for subagent (clean slate)
const taskDescription = step.description ?? 'Execute task'
const subagentCtx = buildSubagentContext(ctx, taskDescription)

// Pass subagentCtx instead of ctx to runSubagentLoop
let result = await runSubagentLoop(subagentCtx, step, filteredTools, config, runConfig, registry)
```

Also update the retry loop to use `subagentCtx`:

```typescript
const retryResult = await runSubagentLoop(
  subagentCtx, step, filteredTools, config, runConfig, registry,
  { ... },
)
```

And update `handleSpawnSubagent()` to pass the already-minimized context:

```typescript
// In handleSpawnSubagent, the ctx is already minimal (came from buildSubagentContext)
// so child subagents automatically get a clean context too
return runSubagentV2(ctx, childStep, childToolDefs, config, registry, true)
```

#### 7.3 Keep logging using the original traceId

The `subagentCtx.traceId` is the same as `ctx.traceId` (we kept it), so all existing logging remains correct.

### What NOT to change

- Do NOT change the function signatures of `runSubagentV2()` or `runSubagentLoop()`.
- Do NOT change the guardrails, verifier, or spawn logic.
- Do NOT change `runSubagent()` (legacy wrapper).

---

## Step 8: Create `src/engine/agentic/index.ts`

Barrel export for the agentic loop module.

```typescript
// src/engine/agentic/index.ts
// Public API of the agentic loop engine.

export { runAgenticLoop } from './agentic-loop.js'
export { postProcess } from './post-processor.js'
export { classifyEffort } from './effort-router.js'

export type {
  AgenticConfig,
  AgenticResult,
  EffortLevel,
  ToolCallLog,
  LoopAction,
  LoopDetectorResult,
} from './types.js'
```

### Notes

- Only export what Instance 4 (integration) and the engine orchestrator need.
- Do NOT export `ToolDedupCache` or `ToolLoopDetector` — they are internal implementation details.
- Do NOT export `LoopCallEntry` — internal type.

---

## Step 9: Update `src/engine/CLAUDE.md`

Add a section describing the new agentic architecture. Insert it AFTER the existing "Archivos" section and BEFORE "Concurrencia".

### Content to add

```markdown
## Agentic Loop (v2 — replaces Phases 2+3+4)

New in v2.0.0. When `ENGINE_MODE=agentic` (default), Phases 2+3+4 are replaced by a single agentic loop where the LLM calls tools natively and composes the response in the same conversation.

### Files: `engine/agentic/`

```
agentic/
  types.ts            — AgenticConfig, AgenticResult, EffortLevel, ToolCallLog, LoopDetectorResult
  effort-router.ts    — deterministic complexity classifier (no LLM, <5ms)
  tool-dedup-cache.ts — per-pipeline dedup cache for identical tool calls
  tool-loop-detector.ts — anti-loop: generic repeat, no-progress, ping-pong detection
  agentic-loop.ts     — THE CORE: LLM + tool calling loop (replaces Phases 2+3+4)
  post-processor.ts   — criticizer (smart mode) + channel formatting + TTS → CompositorOutput
  index.ts            — public exports
```

### How the agentic loop works

1. **Effort Router**: `classifyEffort(ctx)` classifies message as low/medium/high (deterministic, <5ms)
2. **System Prompt**: assembled by prompt builder (identity + job + guardrails + tools + knowledge + history)
3. **Loop**: `runAgenticLoop(ctx, systemPrompt, tools, config, registry)`:
   - Calls `callLLMWithFallback()` with system prompt + messages + tool definitions
   - If LLM returns text only → done, return as final response
   - If LLM returns tool_calls → execute via `ToolRegistry.executeTool()`, feed results back
   - Protections: dedup cache (skip identical calls), loop detector (graduated: warn → block → circuit break)
   - Parallel tool execution via `StepSemaphore`
   - Max turn limit → forces text-only final response
4. **Post-processor**: `postProcess(result, ctx, config, registry)`:
   - Criticizer (only for effort=high or 3+ tool calls)
   - `formatForChannel()` → split for WA/Chat, HTML for email
   - TTS if audio response needed
   - Returns `CompositorOutput` (same type as Phase 4)

### Connection to pipeline

- **Input**: ContextBundle from Phase 1 (unchanged)
- **Output**: CompositorOutput → fed to Phase 5 (validate + send)
- Phase 1 stays as-is. Phase 5 stays with minor adaptations.
- Phases 2, 3, 4 are kept behind `ENGINE_MODE=legacy` feature flag.

### Tool execution path

```
LLM produces tool_calls
  → loop detector pre-check (allow/block/circuit_break)
  → dedup cache check (hit → return cached)
  → registry.getOptional<ToolRegistry>('tools:registry')
  → toolRegistry.executeTool(name, input, context)
  → dedup cache store
  → loop detector post-check (record call, detect patterns)
  → results fed back to LLM as next user message
```
```

Also update the existing file map in the "Archivos" section to include the `agentic/` directory listing.

---

## Execution Order Summary

| Step | File | Action | Dependencies |
|------|------|--------|-------------|
| 0 | — | Create branch, directory | None |
| 1 | `agentic/types.ts` | Create | None |
| 2 | `agentic/effort-router.ts` | Create | Step 1 (types) |
| 3 | `agentic/tool-dedup-cache.ts` | Create | Step 1 (types) |
| 4 | `agentic/tool-loop-detector.ts` | Create | Step 1 (types) |
| 5 | `agentic/agentic-loop.ts` | Create | Steps 1-4 |
| 6 | `agentic/post-processor.ts` | Create | Step 1 (types) |
| 7 | `subagent/subagent.ts` | Modify | None (independent) |
| 8 | `agentic/index.ts` | Create | Steps 1-6 |
| 9 | `engine/CLAUDE.md` | Modify | After all code |

Steps 1-4 can be done in parallel (they only depend on types, and types is trivial).
Step 5 depends on 1-4.
Steps 6 and 7 can be done in parallel with each other (and with step 5 if types are done).
Steps 8-9 are finalization.

---

## Compile Check

After completing all steps, verify the code compiles:

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Fix all type errors before committing. Common issues to watch for:
- Missing `.js` extension in relative imports (ESM requires it)
- `noUncheckedIndexedAccess` is active: array access returns `T | undefined`, use `!` with guard or `?.`
- Import paths from `../types.js` not `../types`
- ToolResult from `tools:registry` has `toolName`, `durationMs`, `retries` fields (not the simpler `engine/types.ts` ToolResult)

---

## Acceptance Criteria Checklist

1. [ ] All new files compile with `npx tsc --noEmit` (zero errors)
2. [ ] `runAgenticLoop()` accepts ContextBundle + system prompt + tool definitions + AgenticConfig + Registry
3. [ ] Loop handles: no tools needed (text-only response on first turn)
4. [ ] Loop handles: single tool call (one tool, result fed back, then text response)
5. [ ] Loop handles: multiple tool calls in one turn (parallel via StepSemaphore)
6. [ ] Loop handles: tool errors (error fed back to LLM as context, not crash)
7. [ ] Loop handles: turn limit exceeded (forces text-only final response)
8. [ ] Tool dedup cache prevents identical read-only tool calls
9. [ ] Tool dedup cache skips write operations (create, update, delete, send)
10. [ ] Loop detector warns at 3 repeated calls
11. [ ] Loop detector blocks individual tool at 5 repeated calls
12. [ ] Loop detector circuit-breaks all tools at 8 repeated calls
13. [ ] Effort router classifies messages deterministically in <5ms
14. [ ] Effort router returns 'low' for greetings/thanks
15. [ ] Effort router returns 'high' for objections/complex messages
16. [ ] Post-processor produces `CompositorOutput` (reuses existing type, NOT new type)
17. [ ] Post-processor applies criticizer only when appropriate (high effort or 3+ tools)
18. [ ] Post-processor applies channel formatting via `formatForChannel()`
19. [ ] Post-processor handles TTS synthesis
20. [ ] Subagents get fresh context (empty history, no knowledge matches, no buffer summary)
21. [ ] Subagent context keeps identity fields (contactId, agentId, userType, permissions)
22. [ ] NO new database tables created
23. [ ] NO new registry services created (agentic loop is engine code, not a module)
24. [ ] ALL tool calls go through existing `ToolRegistry.executeTool()`
25. [ ] ALL LLM calls go through existing `callLLM()` / `callLLMWithFallback()`
26. [ ] `index.ts` exports only the public API needed by Instance 4

---

## Files Summary

### NEW (7 files)
- `src/engine/agentic/types.ts`
- `src/engine/agentic/effort-router.ts`
- `src/engine/agentic/tool-dedup-cache.ts`
- `src/engine/agentic/tool-loop-detector.ts`
- `src/engine/agentic/agentic-loop.ts`
- `src/engine/agentic/post-processor.ts`
- `src/engine/agentic/index.ts`

### MODIFIED (2 files)
- `src/engine/subagent/subagent.ts` — add `buildSubagentContext()`, use it in `runSubagentV2()`
- `src/engine/CLAUDE.md` — add agentic loop documentation section

### NOT TOUCHED (Instance 4 does these)
- `src/engine/engine.ts`
- `src/engine/types.ts`
- `src/engine/config.ts`
- `src/engine/phases/phase5-validate.ts`

### NOT TOUCHED (Instances 2, 3 do these)
- `src/modules/prompts/` — prompt system
- `src/modules/tools/` — two-tier descriptions
- `src/engine/proactive/` — smart cooldown, orphan recovery
