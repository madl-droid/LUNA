# Instance 2 — Prompt System Rebuild

**Branch:** `reset/instance-2-prompts` (created from `reset`)
**LLM:** sonnet
**Role:** Rebuild the prompt system for LUNA's new agentic engine

---

## Context

LUNA is migrating from a 5-phase pipeline to an agentic loop. The current prompt system has:

- **Evaluator prompt builder** (`engine/prompts/evaluator.ts`) — builds system+user for Phase 2
- **Compositor prompt builder** (`engine/prompts/compositor.ts`) — builds system+user for Phase 4
- **PromptsService** (`modules/prompts/`) — loads identity/job/guardrails/relationship/criticizer from DB

The new system needs **ONE prompt builder** that assembles a dynamic system prompt for the agentic loop, incorporating:

- Identity (with dynamic console params: name, last name, title, company, language, country, accent)
- Job instructions
- Guardrails
- Relationship-{userType} tone
- Accent (dynamic from console settings)
- Channel format rules (dynamic per channel from config_store)
- Voice/TTS tags (when responding with audio)
- Criticizer checklist
- Tool catalog (short descriptions -- two-tier)
- Skill catalog (NEW -- on-demand detail loading)
- Knowledge catalog (filtered by userType)
- Knowledge core documents

The user explicitly wants **MODULAR** prompts, NOT a single unified file. Each section is a separate `.md` file loaded and assembled dynamically.

---

## Key Files to Read First

Read ALL of these completely before writing any code:

- `/docker/luna-repo/docs/plans/reset-v2/overview.md`
- `/docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md`
- `/docker/luna-repo/src/engine/prompts/evaluator.ts` -- understand context injection; REUSE the context layer building logic
- `/docker/luna-repo/src/engine/prompts/compositor.ts` -- understand system prompt assembly; REUSE `getChannelLimit`, `buildFormatFromForm`
- `/docker/luna-repo/src/modules/prompts/prompts-service.ts` -- REUSE; this is the main service
- `/docker/luna-repo/src/modules/prompts/template-loader.ts` -- REUSE; `loadSystemPrompt`, `renderTemplate`
- `/docker/luna-repo/src/modules/prompts/types.ts` -- REUSE and extend
- `/docker/luna-repo/instance/prompts/defaults/` -- ALL 8 files; understand current defaults
- `/docker/luna-repo/instance/prompts/system/` -- key files: `evaluator-system.md`, `channel-format-*.md`, `tts-voice-tags.md`, `criticizer-base.md`
- `/docker/luna-repo/src/engine/utils/prompt-escape.ts` -- REUSE all escape functions

---

## CRITICAL REUSE RULES

These rules are **non-negotiable**. Violating them will cause the work to be rejected.

- Use `registry.getOptional<PromptsService>('prompts:service')` for prompt loading
- Use `promptsService.getCompositorPrompts(userType)` for identity/job/guardrails/relationship
- Use `promptsService.getSystemPrompt(name, variables?)` for system templates
- Use `promptsService.getAgentName()`, `getAgentLastName()`, `getAccent()`, `getLanguage()`
- Use `loadSystemPrompt(name)` from `template-loader.ts` for system prompts
- Use `renderTemplate(template, variables)` from `template-loader.ts`
- Use `escapeForPrompt()`, `escapeDataForPrompt()`, `wrapUserContent()` from `prompt-escape.ts`
- Use `configStore.get(pool, key)` for dynamic console settings
- Use existing `prompt_slots` table for DB-backed prompts
- Use existing `config_store` table for dynamic settings
- REUSE context building logic from `evaluator.ts` (the part that builds user context: memory, knowledge, commitments, history, etc.)
- REUSE `getChannelLimit()` and `buildFormatFromForm()` from `compositor.ts`
- **DO NOT** create new DB tables
- **DO NOT** create new registry services (`prompts:service` already exists)

---

## Execution Plan

### Step 0: Setup

1. Create branch `reset/instance-2-prompts` from `reset`
2. Read ALL key files listed above completely
3. Read `reuse-inventory.md`

---

### Step 1: Create `src/engine/prompts/agentic.ts` -- THE MAIN PROMPT BUILDER

This is the central prompt builder for the agentic loop. It replaces BOTH `evaluator.ts` and `compositor.ts` for the new engine mode.

**Function signature:**

```typescript
export async function buildAgenticPrompt(
  ctx: ContextBundle,
  toolCatalog: ToolCatalogEntry[],
  registry: Registry,
  options?: {
    isProactive?: boolean;
    proactiveTrigger?: ProactiveTrigger;
    subagentCatalog?: SubagentCatalogEntry[];
  }
): Promise<{ system: string; userMessage: string }>
```

**System prompt assembly order** (each section clearly tagged with XML-style markers):

1. `<security>` -- Load `security-preamble.md` (via `loadSystemPrompt`)
2. `<identity>` -- From `promptsService.getCompositorPrompts(userType).identity`
   - Auto-prepend dynamic fields: name, last name, title, company, language, country
   - These come from `promptsService` methods + `config_store`
3. `<job>` -- From `promptsService.getCompositorPrompts(userType).job`
4. `<guardrails>` -- From `promptsService.getCompositorPrompts(userType).guardrails`
5. `<relationship>` -- From `promptsService.getCompositorPrompts(userType).relationship`
6. `<accent>` -- Dynamic from console settings (load via `buildAccentSection`)
7. `<agentic_instructions>` -- Load `agentic-system.md` (NEW file, instructions for how to use tools)
   - If `isProactive`: load `proactive-agentic-system.md` instead
8. `<channel_format>` -- Dynamic per channel (REUSE `getChannelLimit` from `compositor.ts`)
9. `<voice_instructions>` -- Only if `responseFormat === 'audio'` (load voice/TTS prompts)
10. `<quality_checklist>` -- From `promptsService.getCompositorPrompts(userType).criticizer`
11. `<tools>` -- Tool catalog with short descriptions (the agentic loop passes actual tool definitions separately -- this is just context for the LLM about when/how to use them)
12. `<skills>` -- Skill catalog stubs (NEW -- on-demand loading)
13. `<knowledge_catalog>` -- Available knowledge categories and core docs
14. `<datetime>` -- Current date/time in agent's timezone

**User message assembly** (REUSE from `evaluator.ts` context building):

1. User type, contact info, lead status
2. Session summary if compressed (from `ctx.bufferSummary`)
3. Contact memory: summary + key facts
4. Pending commitments
5. Relevant conversation summaries
6. Campaign context
7. Qualification state (BANT)
8. Knowledge injection (categories + items + core docs)
9. Assignment rules
10. Knowledge matches / Freshdesk matches
11. HITL pending context
12. Injection warning
13. Recent history (last N messages)
14. If proactive: trigger info (type, reason, commitment data)
15. The actual user message (wrapped with security)

**IMPORTANT:** Extract the context building logic from `evaluator.ts` into a shared function that both the legacy evaluator AND the new agentic builder can use. This prevents duplication.

---

### Step 2: Create `src/engine/prompts/context-builder.ts` -- SHARED CONTEXT BUILDER

Extract from `evaluator.ts` the logic that builds the user message context layers. This function is used by BOTH the legacy evaluator prompt builder AND the new agentic prompt builder.

```typescript
export async function buildContextLayers(
  ctx: ContextBundle,
  registry: Registry,
  options?: {
    includeToolCatalog?: boolean;
    includeSubagentCatalog?: boolean;
    // ... other options
  }
): Promise<string>
```

This extracts lines ~150-375 from `evaluator.ts` into a reusable function. Then modify `evaluator.ts` to call this function instead of inline logic.

---

### Step 3: Create `src/engine/prompts/skills.ts` -- SKILL SYSTEM

Skills are behavioral patterns/interaction protocols (different from tools which perform actions).

```typescript
export interface SkillDefinition {
  name: string;
  description: string;       // short, for catalog stub
  file: string;              // path to full instructions .md
  userTypes: string[];       // which user types can trigger this skill
  triggerPatterns?: string[]; // optional: regex patterns that suggest this skill
}

export async function loadSkillCatalog(
  registry: Registry,
  userType: string,
): Promise<SkillDefinition[]>

export async function loadSkillDetail(skillName: string): Promise<string>

export function buildSkillCatalogSection(skills: SkillDefinition[]): string
```

Skills are defined in `instance/prompts/system/skills/` directory (NEW). Each skill is a `.md` file with full instructions. The catalog section in the system prompt only includes name + short description (stub). When the LLM needs detailed instructions, it references the skill by name and the full content can be injected in subsequent turns.

**Initial skills to create** (placeholder `.md` files):

- `sales-discovery.md` -- BANT qualification conversation flow
- `objection-handling.md` -- Bryan Tracy 6-step method (extract from job.md)
- `appointment-scheduling.md` -- Meeting booking flow
- `follow-up-strategy.md` -- How to follow up on different lead stages

---

### Step 4: Create `src/engine/prompts/accent.ts` -- ACCENT SYSTEM

Dynamic accent injection based on console settings.

```typescript
export async function buildAccentSection(
  db: Pool,
  registry: Registry,
): Promise<string>
```

- Read accent config from `config_store` (`AGENT_ACCENT`, `AGENT_ACCENT_PROMPT`)
- If accent is set, load the corresponding accent prompt from `instance/prompts/system/accents/` or from `config_store`
- The `PromptsService` already has `getAccent()` -- USE IT
- Return formatted accent section or empty string if no accent configured

---

### Step 5: Create `instance/prompts/system/agentic-system.md`

Instructions for the LLM on how to behave in the agentic loop:

- You have access to tools. Use them when needed to fulfill the user's request.
- Think before acting: determine if you need information or actions before responding.
- Call tools only when necessary -- simple greetings don't need tools.
- When tool results are insufficient, you can call additional tools or ask the user for clarification.
- Always compose your final response considering ALL tool results and conversation context.
- Respond in the language the user is speaking.
- Follow the channel format rules strictly.
- If you're uncertain about data, use a tool to verify rather than guessing.

Keep this **SHORT** (under 500 words). The LLM doesn't need verbose instructions for tool use -- it's native behavior.

---

### Step 6: Create `instance/prompts/system/proactive-agentic-system.md`

Instructions for proactive mode (outbound messages):

- You are initiating contact, not responding to a message.
- Your trigger is: `{triggerType}` -- `{reason}`
- Be respectful of the contact's time. Keep messages brief.
- If following up on a commitment, reference what was promised.
- If the situation doesn't warrant outreach, respond with exactly: `[NO_ACTION]`
- Never be pushy or aggressive in proactive outreach.
- Check business hours before scheduling calls.

---

### Step 7: Optimize `instance/prompts/system/session-compression.md`

Review and improve the compression prompt:

- Ensure it preserves BANT data, commitments, objections, preferences
- Make it produce structured output that's easy to inject into future contexts
- Target: <500 words output

---

### Step 8: Optimize `instance/prompts/system/buffer-compressor.md`

Review and improve the buffer compression prompt:

- MicroCompact pattern: identify what can be trimmed WITHOUT LLM (old tool outputs, repeated greetings)
- For LLM-based compression: focus on preserving actionable information

---

### Step 9: Create `instance/prompts/system/skills/` directory with initial skill files

Create four initial skill files:

- `sales-discovery.md`
- `objection-handling.md`
- `appointment-scheduling.md`
- `follow-up-strategy.md`

Each file should have:

- Clear title
- Step-by-step interaction flow
- Examples of good/bad behavior
- When to use this skill
- When NOT to use this skill

---

### Step 10: Update `src/modules/prompts/types.ts`

- Add `SkillDefinition` type (or import from `engine/prompts/skills.ts`)
- Add accent-related types if needed
- **DO NOT** break existing `PromptsService` interface

---

### Step 11: Update `src/modules/prompts/prompts-service.ts`

- Add method to list available skills (reads from `skills/` directory)
- Ensure accent methods work with the new accent builder
- **DO NOT** break existing `getCompositorPrompts`, `getPrompt`, etc.

---

### Step 12: Modify `src/engine/prompts/evaluator.ts`

- Extract context building logic to `context-builder.ts` (Step 2)
- Make `evaluator.ts` call the shared function
- This keeps the legacy evaluator working while sharing code with the new agentic builder

---

### Step 13: Update CLAUDE.md for prompts module

Update `/docker/luna-repo/src/modules/prompts/CLAUDE.md` with:

- New skill system
- Accent system
- How agentic prompt builder works
- Relationship to legacy evaluator/compositor

---

## Files Created/Modified Summary

**NEW files:**

| File | Purpose |
|------|---------|
| `src/engine/prompts/agentic.ts` | Main agentic prompt builder |
| `src/engine/prompts/context-builder.ts` | Shared context layer builder |
| `src/engine/prompts/skills.ts` | Skill system: catalog, loader, section builder |
| `src/engine/prompts/accent.ts` | Dynamic accent section builder |
| `instance/prompts/system/agentic-system.md` | Agentic loop instructions |
| `instance/prompts/system/proactive-agentic-system.md` | Proactive mode instructions |
| `instance/prompts/system/skills/sales-discovery.md` | Skill: BANT qualification flow |
| `instance/prompts/system/skills/objection-handling.md` | Skill: Bryan Tracy 6-step method |
| `instance/prompts/system/skills/appointment-scheduling.md` | Skill: Meeting booking flow |
| `instance/prompts/system/skills/follow-up-strategy.md` | Skill: Follow-up strategy by lead stage |

**MODIFIED files:**

| File | Change |
|------|--------|
| `src/engine/prompts/evaluator.ts` | Extract shared logic to `context-builder.ts` |
| `src/modules/prompts/types.ts` | Add skill types |
| `src/modules/prompts/prompts-service.ts` | Add skill listing method |
| `src/modules/prompts/CLAUDE.md` | Document new systems |
| `instance/prompts/system/session-compression.md` | Optimize |
| `instance/prompts/system/buffer-compressor.md` | Optimize |

---

## Acceptance Criteria

1. All files compile with `npx tsc --noEmit`
2. `buildAgenticPrompt()` produces a complete system prompt + user message
3. System prompt includes all 14 sections in correct order
4. Context builder is shared between legacy evaluator and new agentic builder
5. Skills system loads catalog and can load individual skill details
6. Accent section loads dynamically from `config_store`
7. Channel format rules load dynamically (reuse `getChannelLimit`)
8. Proactive mode has its own instructions
9. Legacy `evaluator.ts` still works (not broken)
10. NO new DB tables created
11. NO new registry services created
12. All prompt loading goes through existing `PromptsService` or `template-loader`

---

## Dependency Notes

- This instance has NO hard dependencies on other instances
- Instance 1 (agentic loop) will CONSUME `buildAgenticPrompt()` -- coordinate on the function signature
- Instance 3 (tools) will provide `ToolCatalogEntry[]` -- coordinate on the type definition
- The skill system's on-demand loading will be integrated by Instance 1 when it wires the agentic loop
