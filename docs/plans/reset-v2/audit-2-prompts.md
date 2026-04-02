# Audit Plan — Instance 2: Prompt System Rebuild

**Branch**: `reset/instance-2-prompts`
**LLM**: `sonnet`

## Pre-Audit: Read These First
- /docker/luna-repo/docs/plans/reset-v2/instance-2-prompts.md (the plan)
- /docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md
- ALL new/modified files from Instance 2

## Audit Checklist

### 1. Compilation
```bash
npx tsc --noEmit
```
Must pass with ZERO errors.

### 2. File Inventory
- [ ] src/engine/prompts/agentic.ts
- [ ] src/engine/prompts/context-builder.ts
- [ ] src/engine/prompts/skills.ts
- [ ] src/engine/prompts/accent.ts
- [ ] instance/prompts/system/agentic-system.md
- [ ] instance/prompts/system/proactive-agentic-system.md
- [ ] instance/prompts/system/skills/ directory with at least 4 skill files
- [ ] instance/prompts/system/session-compression.md (optimized)
- [ ] instance/prompts/system/buffer-compressor.md (optimized)
- [ ] src/modules/prompts/CLAUDE.md (updated)

### 3. Reuse Compliance
- [ ] `buildAgenticPrompt()` uses `promptsService.getCompositorPrompts(userType)` for identity/job/guardrails/relationship — NOT direct file reads
- [ ] System templates loaded via `loadSystemPrompt(name)` or `promptsService.getSystemPrompt(name)` — NOT direct fs.readFile
- [ ] Template variables resolved via `renderTemplate()` — NOT custom regex
- [ ] Security escaping uses `escapeForPrompt()`, `escapeDataForPrompt()`, `wrapUserContent()` from prompt-escape.ts
- [ ] Agent info uses `promptsService.getAgentName()`, `getAgentLastName()`, `getAccent()`, `getLanguage()` — NOT direct config reads
- [ ] Channel format uses existing `getChannelLimit()` or `buildFormatFromForm()` from compositor.ts — NOT recreated
- [ ] Config values read via `configStore.get()` — NOT process.env
- [ ] NO new DB tables created
- [ ] NO new registry services created
- [ ] Existing prompt_slots table used for DB-backed prompts

### 4. Agentic Prompt Builder
- [ ] `buildAgenticPrompt()` returns `{ system: string; userMessage: string }`
- [ ] System prompt sections are clearly tagged (`<identity>`, `<job>`, etc.)
- [ ] Section order matches plan: security → identity → job → guardrails → relationship → accent → agentic_instructions → channel_format → voice → quality_checklist → tools → skills → knowledge → datetime
- [ ] Proactive mode works: when isProactive=true, uses proactive-agentic-system.md
- [ ] Tool catalog section uses short descriptions (not full descriptions)
- [ ] Skill catalog shows stubs only (name + description, not full content)
- [ ] Knowledge catalog is filtered by userType permissions

### 5. Context Builder (shared)
- [ ] `buildContextLayers()` is a standalone function in context-builder.ts
- [ ] Legacy evaluator.ts now calls `buildContextLayers()` instead of inline logic
- [ ] Both agentic.ts and evaluator.ts can use it without conflicts
- [ ] All context layers present: user type, contact, session summary, memory, commitments, summaries, campaign, qualification, knowledge, assignment rules, HITL, injection warning, history, message
- [ ] Legacy evaluator still works correctly after extraction

### 6. Skills System
- [ ] `SkillDefinition` interface is clean (name, description, file, userTypes)
- [ ] `loadSkillCatalog()` reads from skills/ directory
- [ ] `loadSkillDetail()` loads full .md content for a specific skill
- [ ] Skills are filterable by userType
- [ ] At least 4 skill files exist with meaningful content
- [ ] Skill files have: title, step-by-step flow, examples, when to use/not use

### 7. Accent System
- [ ] `buildAccentSection()` reads from config_store (AGENT_ACCENT, AGENT_ACCENT_PROMPT)
- [ ] Returns empty string if no accent configured
- [ ] Uses promptsService.getAccent() where available
- [ ] Does NOT hardcode accent content

### 8. Prompt Quality
- [ ] agentic-system.md is under 500 words (concise)
- [ ] proactive-agentic-system.md mentions [NO_ACTION] as safe default
- [ ] session-compression.md preserves BANT, commitments, objections
- [ ] No typos or formatting issues in .md files
- [ ] Spanish content is natural (not machine-translated)

### 9. Code Quality
- [ ] All imports use .js extensions (ESM)
- [ ] No `any` types
- [ ] Proper async/await usage
- [ ] Logging uses pino pattern
- [ ] No console.log

### 10. Boundary Respect
- [ ] Does NOT modify engine.ts, types.ts, config.ts
- [ ] Does NOT modify phase5-validate.ts
- [ ] Does NOT modify any channel module
- [ ] Does NOT modify tool-registry.ts or tool-converter.ts
- [ ] Does NOT modify proactive/ files
- [ ] evaluator.ts changes are ONLY extracting shared logic (not changing behavior)

## Fix Protocol
1. Fix compilation errors first
2. Fix reuse violations (replace custom code with existing functions)
3. Fix prompt quality issues
4. Commit: `audit(instance-2): fix [description]`
