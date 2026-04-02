# Instance 5 — Console UI Updates for Agentic Engine

**Branch:** `reset/instance-5-console` (created from `reset` AFTER Instance 4 merge)
**LLM:** sonnet
**Role:** Update the LUNA console SSR web UI to expose all new v2.0.0 agentic engine features

---

## Context

The LUNA console is an SSR web UI built with native Node.js HTTP (no Express), server-rendered HTML templates, and minimal client-side JS. Located in `src/modules/console/`.

After v2.0.0 reset, the following instances have landed changes that need console exposure:

- **Instance 1 (Engine):** New agentic loop replacing Phases 2+3+4, with config keys for ENGINE_MODE, AGENTIC_MAX_TOOL_TURNS, effort levels, loop detection thresholds, tool dedup, partial recovery, criticizer smart mode, execution queue lanes
- **Instance 2 (Prompts):** Skills system, accent support (dynamic from config), AGENT_ACCENT as BCP-47 code with country-based selection, AGENT_ACCENT_PROMPT for custom instructions
- **Instance 3 (Proactivity/Tools):** Smart cooldown (next_check_at adaptive), orphan recovery, conversation guard, two-tier tool descriptions (shortDescription + detailedGuidance)
- **Instance 4 (Integration):** Wired everything together, updated types/config, versioning to 2.0.0

Console pages requiring updates:

| Page | URL | What changes |
|------|-----|--------------|
| Engine Advanced | `/console/agente/advanced` | Agentic loop config, execution queue lanes |
| Subagents | `/console/agente/subagents` | Fresh context option |
| Identity | `/console/agente/identity` | Accent configuration (already partially there) |
| Tools | `/console/herramientas/tools` | Two-tier descriptions |
| Proactivity | Engine module fields or proactive section | Smart cooldown, orphan recovery, conversation guard |

---

## Key Files to Read First

Read ALL of these completely before writing any code:

- `/docker/luna-repo/docs/plans/reset-v2/overview.md` -- overall architecture
- `/docker/luna-repo/docs/plans/reset-v2/reuse-inventory.md` -- what to reuse
- `/docker/luna-repo/src/modules/console/CLAUDE.md` -- console module documentation
- `/docker/luna-repo/src/modules/console/manifest.ts` -- console module lifecycle (HUGE, 9000+ lines)
- `/docker/luna-repo/src/modules/console/server.ts` -- SSR router, page rendering, POST handlers
- `/docker/luna-repo/src/modules/console/templates.ts` -- layout HTML, sidebar, save bar
- `/docker/luna-repo/src/modules/console/templates-i18n.ts` -- i18n dictionary (210+ keys/lang)
- `/docker/luna-repo/src/modules/console/templates-fields.ts` -- field builders: text, secret, num, bool, select, textarea, etc.
- `/docker/luna-repo/src/modules/console/templates-sections.ts` -- section renderers (the big file, especially `renderAdvancedAgentSection`, `renderIdentitySection`, `renderToolsCardsSection`)
- `/docker/luna-repo/src/modules/console/templates-modules.ts` -- dynamic module panels from manifest.console.fields
- `/docker/luna-repo/src/modules/engine/manifest.ts` -- engine module console fields pattern
- `/docker/luna-repo/src/modules/prompts/manifest.ts` -- identity/accent console fields (lines 130-323)
- `/docker/luna-repo/src/modules/subagents/manifest.ts` -- subagent console config + renderSection service
- `/docker/luna-repo/src/modules/tools/manifest.ts` -- tools console fields
- `/docker/luna-repo/src/modules/tools/types.ts` -- ToolDefinition, ToolSettings (two-tier from Instance 3)
- `/docker/luna-repo/src/engine/config.ts` -- EngineConfig, loadEngineConfig() with all env key names
- `/docker/luna-repo/src/engine/types.ts` -- EngineConfig type, ProactiveConfig type
- `/docker/luna-repo/src/engine/prompts/skills.ts` -- skills system from Instance 2
- `/docker/luna-repo/src/modules/prompts/prompts-service.ts` -- accent, skills service

---

## CRITICAL REUSE RULES

These rules are **non-negotiable**. Violating them will cause the work to be rejected.

### Console patterns to follow EXACTLY

- **SSR HTML rendering** -- the console is server-rendered. All pages generate HTML strings. NO client-side React/Vue/etc.
- **Field types** -- use ONLY existing types: `text`, `textarea`, `secret`, `number`, `boolean`, `select`, `divider`, `tags`, `readonly`, `duration`, `model-select`, `volume`. See `templates-fields.ts` for the full list.
- **Field rendering** -- use `renderConsoleField(field, value, lang)` from `templates-fields.ts` for manifest-driven fields. For custom sections, use `textField()`, `numField()`, `boolField()`, `secretField()`, `modelDropdown()` directly.
- **i18n** -- every label and info string MUST have `{ es: '...', en: '...' }`. Use the `t()` function from `templates-i18n.ts` for shared keys. Add new keys to the i18n dictionary if needed.
- **Config persistence** -- use `config_store` via `configStore.get(pool, key)` / `configStore.set(pool, key, value)`. The console server reads from `config_store > .env > defaults`.
- **Hot-reload** -- listen to `console:config_applied` hook for config changes. Modules already do this.
- **Sidebar** -- DO NOT change sidebar structure. Pages are already in the correct categories.
- **CSS classes** -- use existing classes: `.panel`, `.panel-header`, `.panel-body`, `.panel-info`, `.field`, `.field-label`, `.field-info`, `.toggle`, `.module-panel`, `.tool-card`, etc.
- **POST save** -- form fields use `name="CONFIG_KEY"` with `data-original="..."` for dirty tracking. Save goes to `/console/save` which writes to `config_store`.

### What NOT to do

- **DO NOT** add npm dependencies
- **DO NOT** create a SPA or add client-side frameworks
- **DO NOT** create new CSS files -- use existing ones
- **DO NOT** create new API endpoints unless strictly necessary (manifest fields + existing save flow handle most cases)
- **DO NOT** create new DB tables
- **DO NOT** modify kernel files
- **DO NOT** change the sidebar order or structure
- **DO NOT** duplicate HTTP helpers -- use `jsonResponse`, `parseBody`, `parseQuery` from `kernel/http-helpers.js`
- **DO NOT** modify `templates-fields.ts` unless adding a genuinely new field type (unlikely)
- **DO NOT** install new npm packages for the console

---

## Execution Plan

### Step 0: Setup and Orientation

1. Create branch `reset/instance-5-console` from `reset` (after Instance 4 merge)
2. Read ALL key files listed above. Focus especially on:
   - `templates-sections.ts` lines 796-900 (`renderAdvancedAgentSection`) -- this is where engine settings currently live
   - `templates-sections.ts` lines 1411-1600 (`renderIdentitySection`) -- identity/accent page
   - `templates-sections.ts` lines 1327-1405 (`renderToolsCardsSection`) -- tools cards page
   - `server.ts` lines 1493-1630 -- agente and herramientas subpage routing
   - `templates-modules.ts` -- how manifest fields render automatically
3. Read `src/engine/config.ts` to see ALL new config keys added by Instance 1+4
4. Read `src/engine/types.ts` to see `EngineConfig` type extensions (agentic fields)
5. Verify the new config keys exist in the codebase (Instance 4 should have added them)
6. Identify which keys already have console fields vs which are new

**CRITICAL:** Before writing code, make a list of:
- New config keys that Instance 1/2/3/4 added to `EngineConfig` / `loadEngineConfig()`
- Which of those keys already have console fields in module manifests
- Which keys need NEW console fields

---

### Step 1: Update Engine Advanced Page — Agentic Loop Config

**File:** `src/modules/engine/manifest.ts` (add new fields to `console.fields[]`)
**File:** `src/modules/console/templates-sections.ts` (update `renderAdvancedAgentSection`)

The "Advanced" page at `/console/agente/advanced` currently has 3 panels:
1. API Keys (keep as-is)
2. Models table (keep as-is)
3. Advanced features (currently: URL extraction, nightly scoring, compression, report)

Add a NEW Panel 4 (or extend Panel 3) for **Agentic Engine** settings.

#### 1a. Add fields to engine module manifest

In `src/modules/engine/manifest.ts`, add to `configSchema` (Zod):

```typescript
// Agentic engine
ENGINE_MODE: z.string().default('agentic'),
AGENTIC_MAX_TOOL_TURNS: numEnvMin(1, 10),
AGENTIC_EFFORT_DEFAULT: z.string().default('medium'),
// Agentic protections
AGENTIC_TOOL_DEDUP_ENABLED: boolEnv(true),
AGENTIC_LOOP_DETECTION_ENABLED: boolEnv(true),
AGENTIC_LOOP_WARN_THRESHOLD: numEnvMin(2, 3),
AGENTIC_LOOP_BLOCK_THRESHOLD: numEnvMin(3, 5),
AGENTIC_LOOP_CIRCUIT_THRESHOLD: numEnvMin(5, 8),
// Recovery
AGENTIC_PARTIAL_RECOVERY_ENABLED: boolEnv(true),
AGENTIC_CRITICIZER_ENABLED: boolEnv(true),
// Execution queue
EXECUTION_QUEUE_REACTIVE_CONCURRENCY: numEnvMin(1, 8),
EXECUTION_QUEUE_PROACTIVE_CONCURRENCY: numEnvMin(1, 3),
EXECUTION_QUEUE_BACKGROUND_CONCURRENCY: numEnvMin(1, 2),
```

Also add corresponding TS interface fields to `EngineModuleConfig`.

**CHECK FIRST:** Instance 1/4 may have already added these keys to `configSchema`. If so, just add the console fields -- do not duplicate the schema entries.

#### 1b. Add console fields to engine manifest

In `src/modules/engine/manifest.ts` `console.fields[]`, add AFTER existing fields:

**Section: "Motor del Agente" / "Agent Engine"**

```typescript
// -- Agentic Engine --
{ key: '_div_agentic', type: 'divider', label: { es: 'Motor Agentico', en: 'Agentic Engine' } },
{
  key: 'ENGINE_MODE',
  type: 'select',
  label: { es: 'Modo del motor', en: 'Engine Mode' },
  info: {
    es: 'Agentic usa loop nativo con tools. Legacy usa pipeline de 5 fases.',
    en: 'Agentic mode uses a native tool loop. Legacy uses the 5-phase pipeline.',
  },
  options: [
    { value: 'agentic', label: 'Agentic Loop (v2)' },
    { value: 'legacy', label: 'Pipeline Legacy (v1)' },
  ],
  width: 'half',
},
{
  key: 'AGENTIC_MAX_TOOL_TURNS',
  type: 'number',
  label: { es: 'Turnos max de herramientas', en: 'Max tool turns' },
  info: {
    es: 'Maximo de iteraciones tool-use por mensaje. Minimo 3, maximo 30.',
    en: 'Maximum tool call cycles per message. Minimum 3, maximum 30.',
  },
  min: 3, max: 30, width: 'half',
},
{
  key: 'AGENTIC_EFFORT_DEFAULT',
  type: 'select',
  label: { es: 'Nivel de esfuerzo por defecto', en: 'Default effort level' },
  info: {
    es: 'Controla la profundidad de razonamiento. Bajo=rapido, Alto=completo.',
    en: 'Controls reasoning depth. Low=fast, High=thorough.',
  },
  options: [
    { value: 'low', label: { es: 'Bajo / Low', en: 'Low' } },
    { value: 'medium', label: { es: 'Medio / Medium', en: 'Medium' } },
    { value: 'high', label: { es: 'Alto / High', en: 'High' } },
  ],
  width: 'half',
},
```

**Section: "Enrutamiento por Esfuerzo" / "Effort Routing"**

```typescript
{
  key: 'ENGINE_EFFORT_ROUTING',
  type: 'boolean',
  label: { es: 'Enrutamiento por esfuerzo', en: 'Effort routing' },
  info: {
    es: 'Clasifica mensajes por complejidad para optimizar costos. Cada nivel usa un modelo distinto.',
    en: 'Classifies messages by complexity to optimize costs. Each level uses a different model.',
  },
},
```

**Section: "Protecciones" / "Safeguards"**

```typescript
// -- Protections --
{ key: '_div_agentic_protections', type: 'divider', label: { es: 'Protecciones', en: 'Safeguards' } },
{
  key: 'AGENTIC_TOOL_DEDUP_ENABLED',
  type: 'boolean',
  label: { es: 'Cache de herramientas', en: 'Tool cache' },
  info: {
    es: 'Evita llamadas duplicadas a la misma herramienta con los mismos parametros.',
    en: 'Prevents repeated calls to the same tool with the same parameters.',
  },
},
{
  key: 'AGENTIC_LOOP_DETECTION_ENABLED',
  type: 'boolean',
  label: { es: 'Deteccion de loops', en: 'Loop detection' },
  info: {
    es: 'Detecta y previene loops infinitos de herramientas.',
    en: 'Detects and prevents infinite tool loops.',
  },
},
{
  key: 'AGENTIC_LOOP_WARN_THRESHOLD',
  type: 'number',
  label: { es: 'Umbral de advertencia', en: 'Warning threshold' },
  info: {
    es: 'Cantidad de llamadas repetidas antes de advertir al LLM.',
    en: 'Number of repeated calls before warning the LLM.',
  },
  min: 2, max: 10, width: 'third',
},
{
  key: 'AGENTIC_LOOP_BLOCK_THRESHOLD',
  type: 'number',
  label: { es: 'Umbral de bloqueo', en: 'Block threshold' },
  info: {
    es: 'Cantidad de llamadas repetidas antes de bloquear la herramienta.',
    en: 'Number of repeated calls before blocking the tool.',
  },
  min: 3, max: 15, width: 'third',
},
{
  key: 'AGENTIC_LOOP_CIRCUIT_THRESHOLD',
  type: 'number',
  label: { es: 'Umbral de corte', en: 'Circuit threshold' },
  info: {
    es: 'Cantidad de llamadas repetidas antes de forzar una respuesta sin herramientas.',
    en: 'Number of repeated calls before forcing a response without tools.',
  },
  min: 5, max: 20, width: 'third',
},
{
  key: 'AGENTIC_ERROR_AS_CONTEXT',
  type: 'boolean',
  label: { es: 'Errores como contexto', en: 'Errors as context' },
  info: {
    es: 'Envia errores de herramientas al LLM para que decida que hacer.',
    en: 'Sends tool errors to the LLM so it can decide what to do.',
  },
},
```

**Section: "Recuperacion" / "Recovery"**

```typescript
// -- Recovery --
{ key: '_div_agentic_recovery', type: 'divider', label: { es: 'Recuperacion', en: 'Recovery' } },
{
  key: 'AGENTIC_PARTIAL_RECOVERY_ENABLED',
  type: 'boolean',
  label: { es: 'Recuperacion parcial', en: 'Partial recovery' },
  info: {
    es: 'Si hay timeout, envia texto parcial generado en vez de error.',
    en: 'If the LLM exceeds timeout but already generated text, use that partial text.',
  },
},
{
  key: 'AGENTIC_CRITICIZER_ENABLED',
  type: 'boolean',
  label: { es: 'Verificador de calidad (smart)', en: 'Quality checker (smart)' },
  info: {
    es: 'Revisa respuestas complejas antes de enviar. Solo se activa cuando es necesario.',
    en: 'Reviews complex responses before sending. Only activates when needed.',
  },
},
```

**Section: "Modelos por Esfuerzo" / "Models by Effort"**

```typescript
// -- Models by Effort --
{ key: '_div_effort_models', type: 'divider', label: { es: 'Modelos por Esfuerzo', en: 'Models by Effort' } },
{
  key: 'LLM_LOW_EFFORT_MODEL',
  type: 'model-select',
  label: { es: 'Modelo bajo esfuerzo', en: 'Low effort model' },
  info: {
    es: 'Modelo para mensajes simples (saludos, confirmaciones, preguntas directas).',
    en: 'Model for simple messages (greetings, confirmations, direct questions).',
  },
  width: 'half',
},
{
  key: 'LLM_MEDIUM_EFFORT_MODEL',
  type: 'model-select',
  label: { es: 'Modelo medio esfuerzo', en: 'Medium effort model' },
  info: {
    es: 'Modelo para mensajes de complejidad media (consultas con contexto, seguimientos).',
    en: 'Model for medium complexity messages (contextual queries, follow-ups).',
  },
  width: 'half',
},
{
  key: 'LLM_HIGH_EFFORT_MODEL',
  type: 'model-select',
  label: { es: 'Modelo alto esfuerzo', en: 'High effort model' },
  info: {
    es: 'Modelo para mensajes complejos (multiples herramientas, razonamiento profundo).',
    en: 'Model for complex messages (multiple tools, deep reasoning).',
  },
  width: 'half',
},
```

(Include corresponding provider selects for each model if the `model-select` field type requires an associated provider field.)

**Section: "Cola de Ejecucion" / "Execution Queue"**

```typescript
// -- Execution Queue --
{ key: '_div_exec_queue', type: 'divider', label: { es: 'Cola de Ejecucion', en: 'Execution Queue' } },
{
  key: 'EXECUTION_QUEUE_REACTIVE_CONCURRENCY',
  type: 'number',
  label: { es: 'Concurrencia reactiva', en: 'Reactive concurrency' },
  info: {
    es: 'Mensajes entrantes procesados en paralelo (prioridad maxima).',
    en: 'Incoming messages processed in parallel (highest priority).',
  },
  min: 1, max: 20, width: 'third',
},
{
  key: 'EXECUTION_QUEUE_PROACTIVE_CONCURRENCY',
  type: 'number',
  label: { es: 'Concurrencia proactiva', en: 'Proactive concurrency' },
  info: {
    es: 'Follow-ups y recordatorios procesados en paralelo.',
    en: 'Follow-ups and reminders processed in parallel.',
  },
  min: 1, max: 10, width: 'third',
},
{
  key: 'EXECUTION_QUEUE_BACKGROUND_CONCURRENCY',
  type: 'number',
  label: { es: 'Concurrencia background', en: 'Background concurrency' },
  info: {
    es: 'Tareas de fondo (nightly, cache) procesadas en paralelo.',
    en: 'Background tasks (nightly, cache) processed in parallel.',
  },
  min: 1, max: 5, width: 'third',
},
```

#### 1c. Update renderAdvancedAgentSection (custom renderer)

If the engine fields above render via `renderModulePanels()` automatically, no change needed in `templates-sections.ts`. But if `renderAdvancedAgentSection` is a custom renderer that hardcodes fields (which it does -- it uses `secretField`, `numField`, `boolField` directly), then:

**Option A (preferred):** Add the new fields to the custom renderer in `renderAdvancedAgentSection` as a new collapsible Panel 4.

**Option B:** If the engine manifest fields ALSO render automatically via `renderModulePanels`, check for duplicates. The `renderAdvancedAgentSection` function currently renders some engine settings manually. Make sure the new agentic fields are either:
- In the custom renderer (Panel 4), OR
- In the manifest fields (rendered via module panel), BUT NOT BOTH

**CHECK:** Look at `server.ts` line 1498-1499 to see how `renderAdvancedAgentSection` is called. It receives `sectionData` and renders directly -- it does NOT use the module manifest fields. So the new agentic fields should go in the custom renderer, matching the pattern of the existing panels.

**Implementation:** Add to `renderAdvancedAgentSection` in `templates-sections.ts`:

```typescript
// Panel 4: Agentic Engine
h += `<div class="panel">
  <div class="panel-header" onclick="togglePanel(this)">
    <span class="panel-title">${isEs ? 'Motor Agentico' : 'Agentic Engine'}</span>
    <span class="panel-chevron">&#9660;</span>
  </div>
  <div class="panel-body">
    <div class="panel-info">${isEs
      ? 'Configuracion del loop agentico, protecciones y cola de ejecucion.'
      : 'Agentic loop configuration, protections and execution queue.'}</div>

    ${/* ENGINE_MODE select */}
    ${/* AGENTIC_MAX_TOOL_TURNS number */}
    ${/* AGENTIC_EFFORT_DEFAULT select */}
    ${/* ENGINE_EFFORT_ROUTING boolean */}
    ...sub-sections for Safeguards, Recovery, Models by Effort, Execution Queue...
  </div>
</div>`
```

Use the same field helper functions (`boolField`, `numField`, etc.) that the existing panels use.

**IMPORTANT:** The custom renderer in `renderAdvancedAgentSection` uses direct field helpers, NOT manifest fields. Follow that pattern exactly. Look at how Panel 3 uses `boolField()` and `numField()` for reference.

For `select` fields in the custom renderer, there is no existing `selectField()` helper in the functions currently used by `renderAdvancedAgentSection`. Options:
1. Use `renderConsoleField()` from `templates-fields.ts` which handles select fields (preferred -- it works with ConsoleField objects)
2. Write inline HTML for selects (matching existing select field CSS patterns from `.field` and `<select>`)

Check `templates-fields.ts` for how select fields render -- use the same CSS structure.

---

### Step 2: Update Subagent Console -- Fresh Context Option

**File:** `src/modules/subagents/manifest.ts`
**File:** `src/modules/subagents/templates.ts` (if custom render exists)

#### 2a. Understand current subagent console

The subagents module has:
- `console.fields: []` (empty! -- it uses a custom renderer instead)
- A `subagents:renderSection` service registered in `init()` that calls `renderSubagentsSection()`
- The custom renderer in `templates.ts` renders cards for each subagent type with CRUD

#### 2b. Add SUBAGENT_FRESH_CONTEXT config

The fresh context option should be a GLOBAL toggle (not per-subagent-type). Two approaches:

**Approach A (manifest field):** Add a `configSchema` to the subagents module and add `SUBAGENT_FRESH_CONTEXT` as a boolean field. Then add a console field. BUT the subagents module currently has NO configSchema (config lives in DB table).

**Approach B (render in custom section):** Add a global settings panel at the top of the subagents custom renderer that includes the fresh context toggle. Save it to `config_store` like other console settings.

**Recommended: Approach A** -- Add configSchema with the single field, then add it to console.fields:

```typescript
// In manifest.ts
import { boolEnv } from '../../kernel/config-helpers.js'

configSchema: z.object({
  SUBAGENT_FRESH_CONTEXT: boolEnv(true),
}),

console: {
  ...existing,
  fields: [
    {
      key: 'SUBAGENT_FRESH_CONTEXT',
      type: 'boolean',
      label: { es: 'Contexto limpio para subagentes', en: 'Fresh context for subagents' },
      info: {
        es: 'Los subagentes reciben solo el contexto minimo necesario, no el historial completo del padre.',
        en: 'Subagents receive only the minimum necessary context, not the parent full history.',
      },
    },
  ],
},
```

**CHECK FIRST:** Instance 1/4 may have already added `SUBAGENT_FRESH_CONTEXT` to the subagents module config or the engine config. If it exists elsewhere, just add the console field pointing to the correct key.

#### 2c. Render the field above the custom subagent cards

Since the subagents page uses a custom renderer (`subagents:renderSection`), the manifest `console.fields` might not render automatically on that page. Check how `server.ts` handles the subagents subpage (line 1519-1528):

```typescript
} else if (agenteSubpage === 'subagents') {
  const renderFn = registry.getOptional<(lang: string) => Promise<string>>('subagents:renderSection')
  if (renderFn) {
    sectionData.agenteContent = await renderFn(lang)
  }
}
```

It calls the custom renderer directly and ignores manifest fields. So the field must be rendered INSIDE the custom renderer.

**Solution:** Modify `src/modules/subagents/templates.ts`:
- At the top of `renderSubagentsSection()`, add a small panel with the fresh context toggle BEFORE the subagent cards.
- The toggle should be a standard `<label class="toggle">` with a hidden input `name="SUBAGENT_FRESH_CONTEXT"`.
- Since this is inside a custom renderer but needs to participate in the form save, ensure the field uses the same `name` and `data-original` pattern as other fields.
- Show info text explaining that subagents now get clean context, not the full parent history.

**Alternative:** Modify `server.ts` to render manifest fields FIRST, then the custom section. This is cleaner but requires touching the console server routing.

#### 2d. Show subagent usage stats if available

If Instance 4 created the `subagent_usage` table and it has data, consider adding a readonly stats panel showing:
- Total subagent invocations
- Breakdown by subagent type
- Average execution time

This is a nice-to-have, not a requirement.

---

### Step 3: Update Identity Page -- Accent Configuration

**File:** `src/modules/prompts/manifest.ts` (verify existing fields)
**File:** `src/modules/console/templates-sections.ts` (`renderIdentitySection`)

#### 3a. Check existing accent fields

The prompts module ALREADY has these in its configSchema (lines 138-141):
```typescript
AGENT_ACCENT: z.string().default(''),
AGENT_ACCENT_PROMPT: z.string().default(''),
```

And in console.fields (lines 238-247):
```typescript
{
  key: 'AGENT_ACCENT',
  type: 'text',
  label: { es: 'Acento / Locale', en: 'Accent / Locale' },
  info: { es: 'Codigo BCP-47 (ej: es-MX, es-ES, en-US, pt-BR)...', en: '...' },
  width: 'half',
},
```

AND `renderIdentitySection` already has a sophisticated accent system (lines 1444-1510) with `ACCENT_MAP` mapping language codes to country-based BCP-47 codes.

#### 3b. Verify Instance 2 changes

Instance 2 (Prompts) may have ALREADY updated the accent system. Check what changed:
- Did Instance 2 change `AGENT_ACCENT` from a text field to a select?
- Did Instance 2 add a proper dropdown with the ACCENT_MAP options?
- Did Instance 2 add the `AGENT_ACCENT_PROMPT` textarea?

**If Instance 2 already handled accent UI:** Verify it works correctly and move on.

**If Instance 2 only added the config keys but not the UI:** Update the console:

1. **Change `AGENT_ACCENT` from text to select** in the `renderIdentitySection` custom renderer. The options should include regional accents:

```typescript
options: [
  { value: '', label: { es: 'Sin acento', en: 'No accent' } },
  { value: 'colombiano', label: { es: 'Colombiano', en: 'Colombian' } },
  { value: 'mexicano', label: { es: 'Mexicano', en: 'Mexican' } },
  { value: 'argentino', label: { es: 'Argentino', en: 'Argentine' } },
  { value: 'espanol', label: { es: 'Espanol (Espana)', en: 'Spanish (Spain)' } },
  { value: 'chileno', label: { es: 'Chileno', en: 'Chilean' } },
  { value: 'personalizado', label: { es: 'Personalizado', en: 'Custom' } },
]
```

   The ACCENT_MAP is already defined (lines 1444-1510). Ensure it renders as a `<select>` with option groups by language, where each option value is the accent identifier and the label is the country/region name. Add an empty option `''` for "Sin acento / No accent" and a `'personalizado'` option for "Personalizado / Custom".

2. **Add `AGENT_ACCENT_PROMPT` textarea** that appears when accent is set (not 'ninguno'/empty). This is the custom accent instructions field:

```typescript
{
  key: 'AGENT_ACCENT_PROMPT',
  type: 'textarea',
  label: { es: 'Instrucciones de acento', en: 'Accent instructions' },
  info: {
    es: 'Personaliza las instrucciones del acento. Se inyectan en el contexto del LLM cuando el acento esta activo.',
    en: 'Custom accent instructions. Injected into LLM context when accent is active.',
  },
  placeholder: 'Describe como debe sonar el agente: modismos, expresiones, tono...',
  rows: 4,
}
```

   Default content should be loaded from the corresponding accent prompt file (e.g., `instance/prompts/skills/` or wherever Instance 2 placed accent prompt templates).

#### 3c. Verify existing identity fields are intact

The following fields MUST still work after changes:
- AGENT_NAME (text, half width)
- AGENT_LAST_NAME (text, half width)
- AGENT_TITLE (text, half width)
- AGENT_LANGUAGE (select, half width)
- COMPANY_NAME (text, half width)
- COMPANY_WEBSITES (tags)
- AGENT_COUNTRY (text, half width)
- AGENT_ACCENT (text -> select, half width)
- AGENT_TIMEZONE (if it exists -- check)
- All PROMPT_* textarea fields (identity, job, guardrails, criticizer, relationships)

---

### Step 4: Add Skills Section to Console

**Check if Instance 2 created a skills system with a console interface.**

Skills management should be accessible to users. Two placement options:
a) Add to `/console/agente/` as a new sub-page "skills" (preferred if many skills)
b) Add as a section within `/console/agente/identity` (acceptable if few skills)

#### 4a. If skills are file-based (`.md` files in `instance/prompts/skills/`)

Add a readonly informational section:
- List all available skills from the skills directory
- Show skill name and description
- Show skill status (enabled/disabled)
- Show skill file content in a readonly textarea
- Link or note explaining that skills are managed via files
- For each skill, show which user types it is available to

```typescript
// Example readonly skill display
{
  key: '_div_skills', type: 'divider', label: { es: 'Habilidades del Agente', en: 'Agent Skills' },
},
{
  key: '_skills_info', type: 'readonly',
  label: { es: 'Habilidades disponibles', en: 'Available skills' },
  info: {
    es: 'Las habilidades se gestionan como archivos .md en instance/prompts/skills/',
    en: 'Skills are managed as .md files in instance/prompts/skills/',
  },
}
```

#### 4b. If Instance 2 added a skills table or API

Add a full skills management section:
- Show skill name, description, active status
- Allow toggling skills on/off per user type
- Allow editing skill content if the API supports it

#### 4c. If adding a new sub-page

If a new `/console/agente/skills` sub-page is created, add it to the sidebar navigation:
- Use existing sidebar patterns -- check how other items are added in the manifest's console.fields configuration
- Match the URL pattern of other agente sub-pages
- Use an appropriate icon from the existing icon set

**This step should be scoped based on what Instance 2 actually implemented.** If skills have no DB/API backing yet, a readonly informational section is sufficient.

---

### Step 5: Update Tools Page -- Two-Tier Descriptions

**File:** `src/modules/tools/types.ts` (verify shortDescription + detailedGuidance fields)
**File:** `src/modules/tools/manifest.ts` (add console fields or API for editing)
**File:** `src/modules/console/templates-sections.ts` (`renderToolsCardsSection`)

#### 5a. Understand current tools page

The tools page at `/console/herramientas/tools` renders:
1. **Tool cards grid** -- each registered tool as a card with icon, title, description, toggle, config button
2. **Global params** -- retry backoff, execution timeout, max tools per turn

Individual tool configuration goes to `/console/herramientas/{moduleName}` which renders the module's manifest fields.

#### 5b. Check Instance 3 changes to tool types

Instance 3 should have added to `ToolDefinition`:
```typescript
shortDescription?: string    // 1 line the model sees when deciding which tools to use
detailedGuidance?: string    // Full instructions injected when the tool is actually used
```

And to `ToolSettings` or a new DB column:
```typescript
shortDescription?: string    // editable override
detailedGuidance?: string    // editable override
```

#### 5c. Add editing for two-tier descriptions

The two-tier descriptions need to be editable per-tool. Two approaches:

**Approach A (API route):** Add PUT endpoints to `/console/api/tools/descriptions`:
```typescript
// PUT /console/api/tools/descriptions
{ toolName: string, shortDescription?: string, detailedGuidance?: string }
```
Then add inline editing in the tool cards or a detail modal.

**Approach B (expand tool card):** When clicking the config icon on a tool card, show an expanded view with:
- `shortDescription` as a text input
- `detailedGuidance` as a textarea

The existing tool settings API (`PUT /console/api/tools/settings`) could be extended to accept `shortDescription` and `detailedGuidance`.

**Recommended: Approach B** -- Extend the existing settings API.

1. **Check** if Instance 3 already extended the `PUT /console/api/tools/settings` handler to accept description fields.

2. **Modify `renderToolsCardsSection`** to add description fields to each tool card:

For each tool, show:
- Current `description` (readonly -- comes from code registration)
- `shortDescription` (editable text input -- override for AI tool selection)
- `detailedGuidance` (editable textarea -- detailed instructions when tool is used)
- Category, enabled status (existing)
- Access rules per user type (existing)

```typescript
// Inside each tool card, after the description div:
cardsHtml += `
  <div class="tool-card-descriptions" style="display:none" id="tool-desc-${esc(mod.name)}">
    <div class="field">
      <span class="field-label">${isEs ? 'Descripcion corta (para IA)' : 'Short description (for AI)'}</span>
      <span class="field-info">${isEs
        ? '1 linea que el modelo de IA ve al decidir que herramientas usar'
        : '1 line the AI model sees when deciding which tools to use'}</span>
      <input type="text" data-tool="${esc(toolName)}" data-field="shortDescription"
             value="${esc(shortDesc)}" placeholder="${esc(defaultDesc)}">
    </div>
    <div class="field">
      <span class="field-label">${isEs ? 'Guia detallada' : 'Detailed guidance'}</span>
      <span class="field-info">${isEs
        ? 'Instrucciones completas que se inyectan cuando la herramienta se usa'
        : 'Full instructions injected when the tool is used'}</span>
      <textarea data-tool="${esc(toolName)}" data-field="detailedGuidance"
                rows="3" placeholder="${isEs ? 'Instrucciones especificas...' : 'Specific instructions...'}">${esc(guidance)}</textarea>
    </div>
  </div>`
```

3. Save via JS: on blur or on save button, POST/PUT to `/console/api/tools/settings` with the new fields.

**NOTE:** The tools page currently renders tool cards from MODULE data (module states), not from the ToolRegistry. The description fields are per-TOOL (from ToolRegistry), not per-module. This means the two-tier descriptions need to be fetched from the tools API, not from module states.

**Solution:** In `server.ts`, when rendering the tools subpage, fetch tool descriptions from the ToolRegistry service and pass them to the renderer via `sectionData`. Add a new field to `SectionData`:

```typescript
toolDescriptions?: Record<string, { shortDescription: string; detailedGuidance: string }>
```

Load it in the tools subpage handler:
```typescript
if (herramientasSubpage === 'tools') {
  // Fetch tool descriptions for two-tier editing
  try {
    const toolsReg = registry.getOptional<ToolRegistry>('tools:registry')
    if (toolsReg) {
      const catalog = toolsReg.getCatalog()
      sectionData.toolDescriptions = Object.fromEntries(
        catalog.map(t => [t.name, { shortDescription: t.shortDescription ?? '', detailedGuidance: t.detailedGuidance ?? '' }])
      )
    }
  } catch {}
  sectionData.herramientasContent = renderSection('tools-cards', sectionData) ?? notAvailable('herramientas')
}
```

---

### Step 6: Update Proactive Settings in Console

**File:** `src/modules/engine/manifest.ts` (add proactive fields to console section)
**File:** `src/modules/console/templates-sections.ts` (if custom renderer needed)

#### 6a. Check current proactive console exposure

Proactive config currently lives in `instance/proactive.json` (loaded by `proactive-config.ts`). Check if:
- Instance 3 moved any proactive settings to `config_store` / env vars
- Instance 4 added console fields for proactive settings
- There's an existing proactive section in the console

**If proactive settings are STILL in proactive.json only:** They need console exposure via `config_store`. This is a larger change that may be out of scope for this instance. In that case:
- Add a `readonly` field showing current proactive.json status
- Add a link/note explaining that proactive config is in `instance/proactive.json`

**If Instance 3/4 moved settings to config_store:** Add console fields for:

**Smart Cooldown:**
```typescript
{ key: '_div_proactive_smart', type: 'divider', label: { es: 'Cooldown Inteligente', en: 'Smart Cooldown' } },
{
  key: 'PROACTIVE_SMART_COOLDOWN_ENABLED',
  type: 'boolean',
  label: { es: 'Cooldown adaptativo', en: 'Adaptive cooldown' },
  info: {
    es: 'Ajusta automaticamente el tiempo de espera entre mensajes proactivos segun la respuesta del contacto.',
    en: 'Automatically adjusts wait time between proactive messages based on contact response.',
  },
},
// Include after_sent_minutes, after_no_action_minutes if available as config keys
```

**Orphan Recovery:**
```typescript
{ key: '_div_proactive_orphan', type: 'divider', label: { es: 'Recuperacion de Huerfanos', en: 'Orphan Recovery' } },
{
  key: 'PROACTIVE_ORPHAN_RECOVERY_ENABLED',
  type: 'boolean',
  label: { es: 'Recuperacion de mensajes huerfanos', en: 'Orphan message recovery' },
  info: {
    es: 'Detecta mensajes que no recibieron respuesta y los reprocesa.',
    en: 'Detects messages that did not receive a response and reprocesses them.',
  },
},
{
  key: 'PROACTIVE_ORPHAN_INTERVAL_MINUTES',
  type: 'number',
  label: { es: 'Intervalo de escaneo (min)', en: 'Scan interval (min)' },
  min: 1, max: 60, width: 'half',
},
```

**Conversation Guard:**
```typescript
{
  key: 'PROACTIVE_CONVERSATION_GUARD_ENABLED',
  type: 'boolean',
  label: { es: 'Guardia de conversacion', en: 'Conversation guard' },
  info: {
    es: 'Suprime mensajes proactivos si el contacto ya se despidio.',
    en: 'Suppresses proactive messages if the contact already said goodbye.',
  },
},
```

**WHERE to put these:** These could go in:
1. The engine module manifest fields (since engine already has nightly batch settings)
2. A new section in `renderAdvancedAgentSection` (Panel 5: Proactive)
3. A dedicated proactive subpage (if it exists)

Check the sidebar for an existing proactive section. If none exists, add to the engine advanced page as a new panel.

---

### Step 7: Update Console Sidebar if Needed

If new pages were added (like skills), add them to the sidebar navigation.

Use existing sidebar patterns:
- Check how other items are added in the manifest's console.fields configuration
- Match the URL and icon patterns of other agente sub-pages
- Use the existing sidebar structure in `templates.ts`
- If only sections were added to existing pages (no new pages), skip this step entirely

**IMPORTANT:** The sidebar is defined in `templates.ts`. Changes should be minimal and follow the existing pattern exactly. Do NOT reorganize existing items.

---

### Step 8: Ensure Hot-Reload Works

All new settings should react to `console:config_applied` hook.

For each module with new config fields:
1. Verify the module listens to `console:config_applied` in its `init()` hooks
2. Verify the handler reloads config from `config_store`
3. Test that changing ENGINE_MODE from console takes effect without restart
4. Test that changing effort routing toggle takes effect immediately
5. Test that changing loop detection thresholds takes effect immediately

The existing pattern in most modules:
```typescript
hooks: {
  'console:config_applied': async () => {
    const config = registry.getConfig<MyConfig>('my-module')
    // Re-read from config_store and update in-memory state
  }
}
```

Verify this pattern exists for the engine module and any other modules with new console fields.

---

### Step 9: Update Console CLAUDE.md

**File:** `src/modules/console/CLAUDE.md`

Add documentation for the new console sections:

```markdown
## Agentic Engine Settings (Panel in /console/agente/advanced)
- ENGINE_MODE, AGENTIC_MAX_TOOL_TURNS, AGENTIC_EFFORT_DEFAULT
- Effort routing toggle (ENGINE_EFFORT_ROUTING)
- Loop detection thresholds (warn, block, circuit)
- Tool dedup, errors as context, partial recovery, criticizer smart mode
- Models by effort (low, medium, high)
- Execution queue lane concurrencies (reactive, proactive, background)

## Subagent Fresh Context (/console/agente/subagents)
- SUBAGENT_FRESH_CONTEXT toggle at top of subagents page

## Accent Configuration (/console/agente/identity)
- AGENT_ACCENT select with regional accent options
- AGENT_ACCENT_PROMPT textarea for custom accent instructions

## Skills Management
- Skills list (readonly or editable depending on Instance 2 implementation)
- Skill enable/disable per user type

## Tool Two-Tier Descriptions (/console/herramientas/tools)
- shortDescription and detailedGuidance editable per tool
- Saved via PUT /console/api/tools/settings

## Proactive Settings (if exposed)
- Smart cooldown, orphan recovery, conversation guard toggles
```

---

### Step 10: Verification and Testing

After all changes:

#### 10a. TypeScript compilation
```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```
Fix ALL type errors before proceeding.

#### 10b. Verify all console pages render

Check these URLs render without errors:
- `/console/agente/advanced` -- should show new Agentic Engine panel with all sections
- `/console/agente/subagents` -- should show fresh context toggle
- `/console/agente/identity` -- should show accent select (not text input) and accent prompt textarea
- `/console/herramientas/tools` -- should show tool cards with two-tier description fields
- `/console/agente/skills` -- should show skills list (if new page was created)

#### 10c. Verify form save works

For each new field:
1. Change the value in the form
2. Click Save
3. Verify the value persists after page refresh
4. Verify `config_store` has the new value

#### 10d. Verify hot-reload

1. Change ENGINE_MODE in the console
2. Verify `console:config_applied` hook fires
3. Verify the engine picks up the new value without restart

#### 10e. Verify i18n

For each new field:
1. Switch console language to `es` -- all labels/info in Spanish
2. Switch to `en` -- all labels/info in English
3. No missing translations

#### 10f. Verify no regressions

- Existing API Keys panel still works
- Existing Models table still works
- Existing identity fields still save correctly
- Existing tool toggles still work
- Subagent CRUD still works
- Sidebar navigation still works
- Mobile layout still works (responsive)

---

## Files Modified Summary

| File | Action | What |
|------|--------|------|
| `src/modules/engine/manifest.ts` | MODIFY | Add agentic + execution queue + proactive + effort models console fields to configSchema and console.fields |
| `src/modules/console/templates-sections.ts` | MODIFY | Update `renderAdvancedAgentSection` with new panels (Agentic Engine, Safeguards, Recovery, Models by Effort, Execution Queue), update `renderToolsCardsSection` for two-tier descriptions, verify `renderIdentitySection` accent UI |
| `src/modules/console/server.ts` | MODIFY | Pass tool descriptions data to tools renderer, possibly adjust subagents rendering |
| `src/modules/subagents/manifest.ts` | MODIFY | Add configSchema with SUBAGENT_FRESH_CONTEXT, add console.fields entry |
| `src/modules/subagents/templates.ts` | MODIFY | Add fresh context toggle panel to custom renderer |
| `src/modules/prompts/manifest.ts` | MODIFY (if needed) | Verify accent fields are correct, add AGENT_ACCENT_PROMPT textarea if missing, update AGENT_ACCENT to select type |
| `src/modules/tools/manifest.ts` | MODIFY (if needed) | Extend settings API to accept shortDescription + detailedGuidance |
| `src/modules/tools/tool-registry.ts` | MODIFY (if needed) | Extend `updateToolSettings` to persist description fields |
| `src/modules/tools/pg-store.ts` | MODIFY (if needed) | Add columns for shortDescription + detailedGuidance if not already added by Instance 3 |
| `src/modules/scheduled-tasks/manifest.ts` | MODIFY (if needed) | Add proactive settings fields if proactive config is in this module |
| `src/modules/console/CLAUDE.md` | MODIFY | Document new console sections |
| `src/modules/console/templates-i18n.ts` | MODIFY (if needed) | Add new i18n keys for shared labels |

**Key architectural insight:** In LUNA, console fields are defined in each MODULE's `manifest.ts` via the `console.fields` array. So engine settings go in engine module, tool settings go in tools module, etc. The console module just renders them. However, pages with custom renderers (advanced, identity, tools, subagents) bypass the manifest field auto-rendering, so new fields must be added to the custom renderers directly OR the routing must be changed to render manifest fields alongside custom content.

---

## Acceptance Criteria

1. All files compile with `npx tsc --noEmit`
2. All console pages render without errors (no 500s, no blank pages)
3. Console shows ENGINE_MODE toggle with agentic/legacy options
4. Console shows effort routing toggle
5. Console shows effort model configuration (low/medium/high model selects)
6. Console shows agentic loop safeguards (tool dedup, loop detection with thresholds, errors as context)
7. Console shows recovery settings (partial recovery, criticizer)
8. Console shows execution queue concurrency settings (reactive/proactive/background lanes)
9. Console shows accent configuration on identity page (select dropdown, not text input)
10. Console shows accent prompt textarea for custom instructions
11. Console shows skills management (at minimum a readonly list)
12. Console shows two-tier tool description fields (shortDescription + detailedGuidance)
13. Console shows proactive improvements settings (smart cooldown, orphan recovery, conversation guard)
14. Subagent page shows fresh context toggle
15. All new settings save to config_store and persist across page refreshes
16. Hot-reload works for all new settings (`console:config_applied` hook fires)
17. All labels have ES and EN translations -- no untranslated strings
18. No new CSS files created
19. No new npm packages installed
20. Existing console pages and functionality not broken
21. Layout follows existing design patterns (responsive, mobile-friendly)

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Add agentic fields to engine module manifest, not a new module | Engine module already owns pipeline config, keeps it consolidated |
| Use custom renderer panels (not manifest auto-render) for advanced page | renderAdvancedAgentSection is already a custom renderer; consistency |
| Add configSchema to subagents module for SUBAGENT_FRESH_CONTEXT | Cleaner than raw config_store access; follows module pattern |
| Extend existing tools settings API for descriptions | Avoids new API endpoints; follows existing CRUD pattern |
| Accent field changed from text to select | Better UX, prevents typos, maps to known accent prompts |
| Proactive settings scope depends on Instance 3/4 | If still in proactive.json, add readonly info; if in config_store, add full fields |
| Skills management is scoped to Instance 2 implementation | Can be managed via .md files initially; console exposure depth depends on backend |
| Models by effort as model-select fields | Reuses existing model-select field type, consistent with main model selection UX |
