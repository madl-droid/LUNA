# Prompts Module Architecture

## Overview

The **prompts module** provides centralized, database-backed management of all agent prompts with real-time editing via console, in-memory caching, and on-demand evaluator generation via LLM.

**Module name:** `prompts`  
**Type:** Feature module  
**Removable:** Yes  
**Default status:** Enabled  
**Location:** `src/modules/prompts/`

---

## Key Concepts

### 1. Prompt Slots and Variants System

The module organizes prompts into **slots** (semantic categories) and **variants** (specialized versions):

#### Slots (PromptSlot type):
- **`identity`** — Who the agent is; personality and base tone
- **`job`** — Mission and main objectives
- **`guardrails`** — Rules and limits the agent must never violate
- **`relationship`** — How to treat different user types (has multiple variants)
- **`criticizer`** — Customizable self-review points before sending responses
- **`evaluator`** — LLM-generated execution plan analyzer (auto-generated, read-only in DB)

#### Variants (examples):
- **Default variant:** `'default'` — applies to most slots
- **Relationship variants:**
  - `'lead'` — potential customers (friendly, patient, service-oriented)
  - `'admin'` — system administrators (technical, direct)
  - `'coworker'` — team members (collaborative, informal)
  - `'unknown'` — unidentified contacts (cautious but friendly)

### 2. Two-Category Prompt Architecture

#### Category 1: Database-Backed Editable Prompts
- **Table:** `prompt_slots`
- **Managed by:** Console UI + API routes
- **Cache:** In-memory Map<string, string> keyed by `"slot:variant"`
- **Sync:** Bidirectional with `config_store` for console field display
- **Slots:** identity, job, guardrails, relationship (all variants), criticizer

#### Category 2: File-Based System Templates
- **Location:** `instance/prompts/system/*.md`
- **Purpose:** Immutable templates for complex subsystems
- **Examples:**
  - `meta-evaluator.md` — Template for generating evaluator prompts
  - `evaluator-system.md` — Evaluation criteria (4.3 KB, detailed spec)
  - `criticizer-base.md` — Fixed quality checklist base
  - `tts-voice-tags.md` — Voice style instructions (3.5 KB)
  - `objection-handler.md` — Sales objection response patterns
  - `channel-format-*.md` — Medium-specific formatting rules
  - `commitment-detector-system.md` — Intent classification spec

**Template loading:** Lazy-loaded with permanent caching; supports variable substitution via `{{variable}}` placeholders.

### 3. Seed Default Prompts

On first initialization, the system seeds from:
- **Location:** `instance/prompts/defaults/*.md`
- **Files:**
  - `identity.md` — "Eres LUNA, una asistente..." (200 bytes)
  - `job.md` — Mission definition (273 bytes)
  - `guardrails.md` — Rules (355 bytes)
  - `criticizer.md` — Customizable checklist points (724 bytes)
  - `relationship-lead.md` — Lead-specific treatment (124 bytes)
  - `relationship-admin.md` — Admin-specific treatment
  - `relationship-coworker.md` — Coworker treatment
  - `relationship-unknown.md` — Unknown contact treatment

**Legacy fallback:** If not found in `instance/prompts/defaults/`, system tries `instance/knowledge/{identity,guardrails}.md` for backwards compatibility.

---

## Database Schema

### Table: `prompt_slots`

```sql
CREATE TABLE prompt_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot TEXT NOT NULL,                      -- 'identity', 'job', 'guardrails', 'relationship', 'criticizer', 'evaluator'
  variant TEXT NOT NULL DEFAULT 'default', -- 'default', 'lead', 'admin', 'coworker', 'unknown'
  content TEXT NOT NULL DEFAULT '',        -- Markdown or plain text
  is_generated BOOLEAN DEFAULT false,      -- true only for evaluator slot
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (slot, variant)
);
```

**Unique constraint:** Prevents duplicate (slot, variant) pairs.  
**is_generated flag:** Marks auto-generated prompts; used for evaluator to track origin.

---

## API Routes

All routes mounted under `/console/api/prompts/`:

### GET /slots
**Returns:** All prompt records with their current content and metadata.
```json
{
  "slots": [
    { "id": "...", "slot": "identity", "variant": "default", "content": "...", "isGenerated": false, "updatedAt": "..." },
    ...
  ]
}
```

### GET /slot
**Query params:**
- `slot` (required) — Prompt slot name
- `variant` (optional, default: 'default')

**Returns:**
```json
{
  "slot": "identity",
  "variant": "default",
  "content": "Eres LUNA..."
}
```

### PUT /slot
**Body:**
```json
{
  "slot": "identity",
  "variant": "default",
  "content": "New prompt content..."
}
```

**Behavior:**
- Upserts to DB
- Updates in-memory cache
- Syncs to `config_store` if matches `PROMPT_SYNC_MAP` (for console field reflection)

**Response:** `{ "ok": true }`

### POST /generate-evaluator
**Trigger:** LLM-based generation of the evaluator prompt.

**Process:**
1. Gathers current identity, job, guardrails, and all relationship variants
2. Renders `meta-evaluator.md` template with these values
3. Calls `llm:chat` hook with system: "Genera resúmenes comprimidos..." at max 600 tokens, temp 0.3
4. Stores result in `prompt_slots` with `is_generated=true`

**Response:**
```json
{
  "ok": true,
  "content": "Eres el módulo evaluador... [compressed summary]"
}
```

### GET /system-prompts
**Returns:** All available system template names and their content.
```json
{
  "templates": [
    { "name": "meta-evaluator", "content": "..." },
    { "name": "criticizer-base", "content": "..." },
    ...
  ]
}
```

### POST /reload-system
**Effect:** Clears the system prompt template cache.  
**Response:** `{ "ok": true, "message": "System prompt template cache cleared" }`

---

## Console Configuration Fields

The manifest defines a console panel at `Prompts del Agente` (order: 5, group: 'agent') with these sections:

### Agent Identity Section
- **AGENT_NAME** (text) — First name; single source of truth for all channels
- **AGENT_LAST_NAME** (text) — Surname; optional
- **AGENT_TITLE** (text) — Job title or role
- **AGENT_LANGUAGE** (select) — Primary language (es/en/pt/fr/de/it)
- **AGENT_COUNTRY** (text) — Operating country; affects regional context
- **AGENT_ACCENT** (text) — BCP-47 locale code (e.g., es-MX, en-US, pt-BR)

### Agent Prompts Section
- **PROMPT_IDENTITY** (textarea) — Who the agent is
- **PROMPT_JOB** (textarea) — What the agent does
- **PROMPT_GUARDRAILS** (textarea) — Rules and limits

### Quality Checklist Section
- **_info_criticizer_base** (readonly) — Notes that base rules are fixed/non-editable
- **PROMPT_CRITICIZER** (textarea) — Customizable self-review points (points 6–10)

### Relationships by User Type Section
- **PROMPT_RELATIONSHIP_LEAD** (textarea) — How to treat potential customers
- **PROMPT_RELATIONSHIP_ADMIN** (textarea) — How to treat admins
- **PROMPT_RELATIONSHIP_COWORKER** (textarea) — How to treat teammates
- **PROMPT_RELATIONSHIP_UNKNOWN** (textarea) — How to treat unidentified contacts

### Sync Map
Internal mapping for bidirectional sync between console fields and DB slots:

| Config Key | Slot | Variant |
|---|---|---|
| PROMPT_IDENTITY | identity | default |
| PROMPT_JOB | job | default |
| PROMPT_GUARDRAILS | guardrails | default |
| PROMPT_CRITICIZER | criticizer | default |
| PROMPT_RELATIONSHIP_LEAD | relationship | lead |
| PROMPT_RELATIONSHIP_ADMIN | relationship | admin |
| PROMPT_RELATIONSHIP_COWORKER | relationship | coworker |
| PROMPT_RELATIONSHIP_UNKNOWN | relationship | unknown |

---

## Service: PromptsServiceImpl

**Export:** `registry.provide('prompts:service', serviceInstance)` in manifest.  
**Interface:** `PromptsService` (see types.ts).

### Core Methods

#### `async getPrompt(slot: PromptSlot, variant?: string): Promise<string>`
- Checks cache first; falls back to DB query
- Returns empty string if not found
- **Caching:** Uses key format `"slot:variant"`

#### `async getCompositorPrompts(userType: string): Promise<CompositorPrompts>`
- Returns `{ identity, job, guardrails, relationship, criticizer }` for a specific user type
- **Relationship resolution:** Tries user-type-specific variant; falls back to 'default' if not found
- **Accent injection:** If AGENT_ACCENT and AGENT_ACCENT_PROMPT are configured, appends TTS style instructions to identity prompt:
  ```
  identity + "\n\n--- ACENTO ---\n" + accentPrompt
  ```
- Used by message composition in other modules (e.g., message-composer)

#### `async generateEvaluator(): Promise<string>`
- **Process:**
  1. Gathers identity, job, guardrails, and all relationship variants
  2. Loads `meta-evaluator.md` template and renders with `{{identity}}`, `{{job}}`, `{{guardrails}}`, `{{relationships}}`
  3. Calls `llm:chat` hook (system: "Genera resúmenes...", maxTokens: 600, temp: 0.3)
  4. Upserts result to DB with `is_generated=true`
  5. Returns the generated content
- **Error handling:** Logs error and returns empty string if LLM call fails
- **Temperature:** 0.3 ensures deterministic, consistent output

#### `async upsert(slot: PromptSlot, variant: string, content: string): Promise<void>`
- Inserts or updates DB record (UNIQUE constraint handles conflict)
- Always updates cache immediately
- Sets `is_generated=true` only if slot is 'evaluator'

#### `async listAll(): Promise<PromptRecord[]>`
- Returns all prompt records sorted by slot, then variant

#### `invalidateCache(): void`
- Clears in-memory cache and reloads asynchronously from DB
- **Caveat:** Brief window where cache is empty; async reload happens in background

#### Agent Identity Accessors
- `getAgentName(): string` — Returns AGENT_NAME config; default: 'Luna'
- `getAgentLastName(): string` — Returns AGENT_LAST_NAME; default: ''
- `getAgentFullName(): string` — Returns trimmed `firstName lastName`
- `getLanguage(): string` — Returns AGENT_LANGUAGE; default: 'es'
- `getAccent(): string` — Returns AGENT_ACCENT (BCP-47); default: ''

#### System Prompt Methods
- `async getSystemPrompt(name: string, variables?: Record<string, string>): Promise<string>`
  - Loads template from `instance/prompts/system/{name}.md`
  - Performs variable substitution if variables provided
  - Returns empty string if template not found
- `clearSystemPromptCache(): void` — Hot-reload cache clear
- `async listSystemPrompts(): Promise<string[]>` — Lists available template names

### Implementation Details

- **Cache field:** `private cache = new Map<string, string>()`
- **DB access:** `readonly db: Pool` exposed publicly (used by manifest API routes to avoid casting)
- **Registry access:** Private registry reference for `getConfig()` and LLM hook calls

---

## Template Loader (`template-loader.ts`)

Located in `src/modules/prompts/template-loader.ts`.

### Functions

#### `loadSystemPrompt(name: string): Promise<string>`
- Reads from `instance/prompts/system/{name}.md`
- Caches permanently in `templateCache` Map
- Returns cached content on subsequent calls
- Logs warning and caches empty string on miss (avoids repeated failed reads)

#### `loadDefaultPrompt(name: string): Promise<string>`
- Reads from `instance/prompts/defaults/{name}.md`
- **No caching** — called only during seed; not reused
- Returns empty string on error

#### `renderTemplate(template: string, variables: Record<string, string>): string`
- Replaces `{{key}}` placeholders with values from variables map
- Regex pattern: `/\{\{(\w+)\}\}/g`
- Logs warning for unresolved keys; replaces with empty string
- Returns empty string if template is falsy

#### `preloadAll(): Promise<number>`
- Called during service initialization
- Reads all `.md` files from `instance/prompts/system/`
- Populates `templateCache` for all templates at startup
- Returns count of preloaded templates
- Graceful failure if directory doesn't exist

#### `clearTemplateCache(): void`
- Clears the template cache Map
- Used by `/reload-system` API endpoint for hot-reload

#### `listTemplates(): Promise<string[]>`
- Returns list of template names (filenames without `.md`)
- Used by `GET /system-prompts` endpoint

---

## TTS/Voice Support: Accent Prompts

The manifest includes **comprehensive BCP-47 accent-based TTS style prompts** (ACCENT_STYLE_PROMPTS record with 20+ Spanish, 12+ English, 5+ Portuguese, 7+ French, 5+ German, 3+ Italian variants).

### How Accent Prompts Work

1. **Configuration:** User sets `AGENT_ACCENT` (e.g., `es-MX`, `en-US`, `pt-BR`)
2. **Auto-generation:** Manifest hook watches `console:config_saved`
   - When AGENT_ACCENT changes, calls `generateAccentPrompt(registry)`
   - Looks up BCP-47 code in ACCENT_STYLE_PROMPTS record
   - Writes style instructions to `AGENT_ACCENT_PROMPT` in config_store
3. **Injection:** `getCompositorPrompts()` appends accent prompt to identity:
   ```
   finalIdentity = identity + "\n\n--- ACENTO ---\n" + AGENT_ACCENT_PROMPT
   ```
4. **TTS usage:** Accent prompt is passed to voice channels (e.g., Twilio) to guide intonation, expressions, and pacing

### Example Accent Styles
- **es-MX:** "Habla con acento mexicano neutro... Tuteo. Pronuncia las 's' claramente. Tono cálido y cercano..."
- **en-GB:** "Speak with a British Received Pronunciation accent... Professional and polished tone."
- **pt-BR:** "Fale com sotaque brasileiro... Entonação melodica e calorosa..."

---

## Lifecycle & Initialization

### Module Init Flow

1. **discover** → Log "Module discovered: prompts"
2. **activate** → Log "Module activated: prompts"
3. **init(registry):**
   - Call `ensureTable(db)` — creates `prompt_slots` if missing
   - Create `PromptsServiceImpl` instance
   - Call `service.initialize()`:
     - Query all records from `prompt_slots`
     - If empty, call `seed()` to load from `instance/prompts/defaults/*.md`
     - Load all records into cache
     - Call `preloadAll()` to preload Category 2 system templates
   - Expose service: `registry.provide('prompts:service', service)`
   - Sync console fields: load DB content into `config_store`
   - Register hooks:
     - `console:config_saved` → sync console fields to DB + auto-generate accent prompt
     - `console:config_applied` → sync + invalidate cache + clear template cache

4. **stop() → **Set service to null

### Hooks Registered

| Hook | Listener | Purpose |
|---|---|---|
| `console:config_saved` | Sync console PROMPT_* fields to DB; auto-generate accent prompt if AGENT_ACCENT changes |
| `console:config_applied` | Full sync + cache invalidation + template cache clear |

---

## Configuration Schema

```typescript
configSchema: z.object({
  AGENT_NAME: z.string().default('Luna'),
  AGENT_LAST_NAME: z.string().default(''),
  AGENT_TITLE: z.string().default(''),
  AGENT_LANGUAGE: z.string().default('es'),
  AGENT_COUNTRY: z.string().default(''),
  AGENT_ACCENT: z.string().default(''),
  AGENT_ACCENT_PROMPT: z.string().default(''),
  TTS_ENABLED: boolEnv(false),
  PROMPTS_MAX_SYSTEM_PROMPT_TOKENS: numEnv(4000),
  PROMPTS_MAX_COMPRESSION_SUMMARY_TOKENS: numEnv(1000),
})
```

**Note:** Prompt content (PROMPT_IDENTITY, PROMPT_JOB, etc.) lives in DB, not config schema; they sync bidirectionally via PROMPT_SYNC_MAP.

---

## Data Flow: Console Edit → DB → Cache

1. **User edits PROMPT_IDENTITY in console UI**
2. **Console POSTs to PUT /slot:**
   ```json
   { "slot": "identity", "variant": "default", "content": "New text..." }
   ```
3. **Handler calls `service.upsert()`**
   - Upserts to `prompt_slots` table
   - Updates cache: `cache.set("identity:default", "New text...")`
4. **Best-effort sync to config_store:**
   - Finds matching entry in PROMPT_SYNC_MAP
   - Calls `configStore.set(db, 'PROMPT_IDENTITY', content, false)`
5. **Hook fires on console save:**
   - `syncConsoleFields()` loads DB back into config_store (console UI reads from config_store for display)
   - Changes apply immediately in console panel

---

## Evaluator Generation Workflow

The **evaluator** is a special LLM-generated prompt that summarizes the agent's identity, mission, and rules for downstream use by intent classifiers or message evaluators.

### Generation Process

**Endpoint:** `POST /console/api/prompts/generate-evaluator`

1. **Gather context:**
   - `identity` from DB (`identity:default`)
   - `job` from DB (`job:default`)
   - `guardrails` from DB (`guardrails:default`)
   - All `relationship` variants: `[lead]: ..., [admin]: ..., [coworker]: ..., [unknown]: ...`

2. **Load template:**
   - Read `instance/prompts/system/meta-evaluator.md`
   - Template structure:
     ```
     Eres un asistente que genera resúmenes comprimidos...
     --- IDENTIDAD ---
     {{identity}}
     --- TRABAJO ---
     {{job}}
     --- REGLAS ---
     {{guardrails}}
     --- RELACIONES ---
     {{relationships}}
     Genera el resumen comprimido ahora...
     ```

3. **Render template:**
   - `renderTemplate(metaTemplate, { identity, job, guardrails, relationships })`

4. **Call LLM:**
   - Hook: `llm:chat`
   - System: "Genera resúmenes comprimidos y precisos. Responde solo con el resumen."
   - Max tokens: 600
   - Temperature: 0.3 (deterministic)

5. **Store result:**
   - Upsert to DB: `prompt_slots` with `evaluator:default`, `is_generated=true`
   - Update cache
   - Return content

### Evaluator Output Example

The output is a compressed (~500-600 token) summary suitable for intent classifiers or evaluators to understand the agent's behavior, constraints, and relationship rules.

---

## Deployment & Migrations

### Database Migrations

- **Table creation:** Automatic via `ensureTable(db)` on module init
- **No schema versions:** Table is simple and stable; changes would be backward-compatible (new columns with defaults)

### File Requirements

- **Must exist:** `instance/prompts/defaults/` with at least:
  - `identity.md`
  - `job.md`
  - `guardrails.md`
  - `criticizer.md`
  - `relationship-*.md` (4 files: lead, admin, coworker, unknown)

- **Should exist:** `instance/prompts/system/` with:
  - `meta-evaluator.md` (required for evaluator generation)
  - `criticizer-base.md` (loaded in console)
  - Other system templates as needed (channel formats, evaluators, objection handlers, etc.)

### Seeding Logic

1. On **first run** (no prompts in DB):
   - Load from `instance/prompts/defaults/*.md`
   - If identity/guardrails not found there, try legacy `instance/knowledge/*.md`
   - Upsert all to DB

2. On **subsequent runs:**
   - DB is source of truth; files only used if DB is cleared

---

## Key Dependencies

- **Modules:**
  - `llm` module (optional) — for evaluator generation only; failure is non-blocking
  - `config-store` — for bidirectional sync with console fields

- **External:**
  - PostgreSQL — prompt_slots table
  - Filesystem — loading templates from instance/ directory

---

## Traps & Common Issues

1. **Cache invalidation:** `invalidateCache()` clears cache synchronously but reloads asynchronously. Brief window where cache is empty.
2. **DB public access:** `readonly db: Pool` is exposed on service for manifest API routes; do not add sensitive logic assuming DB encapsulation.
3. **Template variable placeholder:** Pattern is `{{key}}`, not `${key}` or `{key}`. Unresolved placeholders become empty strings.
4. **Sync map:** Only slots in PROMPT_SYNC_MAP are synced to config_store; other slots (e.g., evaluator) are DB-only.
5. **Relationship variant fallback:** `getCompositorPrompts()` tries user-type-specific variant first, falls back to 'default' if missing; always succeeds (returns at least default).
6. **Evaluator regeneration:** Not automatic. Must call `POST /generate-evaluator` endpoint explicitly (usually triggered by UI after editing prompts).

---

## Files Reference

| Path | Purpose |
|---|---|
| `src/modules/prompts/manifest.ts` | Lifecycle, console config, API routes, sync logic, accent prompts |
| `src/modules/prompts/types.ts` | PromptSlot, PromptRecord, CompositorPrompts, PromptsService interface |
| `src/modules/prompts/prompts-service.ts` | PromptsServiceImpl with cache, DB queries, service methods |
| `src/modules/prompts/template-loader.ts` | File I/O for system templates and defaults; variable substitution |
| `src/modules/prompts/pg-queries.ts` | CRUD for prompt_slots table (ensure, get, upsert, list) |
| `src/modules/prompts/CLAUDE.md` | Module development notes |
| `instance/prompts/defaults/` | Seed prompt files (8 files) |
| `instance/prompts/system/` | Immutable system templates (20 files) |

---

## Related Modules & Concepts

- **Message Composer** — Uses `getCompositorPrompts(userType)` to fetch prompts for message composition
- **Evaluator (Intent Classifier)** — Uses evaluator prompt from this module to classify incoming messages
- **Lead Scoring** — Formerly part of prompts module; now separate
- **Console** — UI for editing prompts; reads/writes via API routes and config_store

