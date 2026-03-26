# Prompts — Gestión centralizada de prompts del agente

Prompts editables desde console, almacenados en DB, con cache en memoria. Evaluador generado on-demand por LLM.

## Archivos
- `manifest.ts` — lifecycle, console fields (textarea), API routes, sync con config_store
- `types.ts` — PromptSlot, PromptRecord, CompositorPrompts, PromptsService
- `pg-queries.ts` — CRUD para prompt_slots
- `prompts-service.ts` — PromptsServiceImpl con cache Map, seed desde archivos/defaults, generación evaluador

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: [] (llm es opcional, solo para generar evaluador)

## Tabla DB: prompt_slots
- `id` UUID PK, `slot` TEXT, `variant` TEXT, `content` TEXT, `is_generated` BOOLEAN, timestamps
- UNIQUE (slot, variant)
- Slots: identity, job, guardrails, relationship, evaluator
- Variants: 'default' para la mayoría; relationship tiene 'lead', 'admin', 'coworker', 'unknown'

## Servicio expuesto
- `prompts:service` — PromptsService interface

## API Routes (bajo /console/api/prompts/)
- GET/PUT slots, POST generate-evaluator

## Nota: Campañas migradas
- Campaign management se movió al módulo `lead-scoring` (ver `src/modules/lead-scoring/CLAUDE.md`)
- `campaign-matcher.ts` eliminado de este módulo

## Trampas
- `db` es `readonly` público en PromptsServiceImpl — API routes lo acceden directamente
- `invalidateCache()` recarga async — breve momento sin cache
- **Helpers HTTP**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`. NO redefinir localmente.
