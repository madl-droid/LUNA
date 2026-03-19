# Prompts — Gestión centralizada de prompts del agente

Prompts editables desde oficina, almacenados en DB, con cache en memoria. Campaign matching via fuse.js.

## Archivos
- `manifest.ts` — lifecycle, oficina fields (textarea), API routes, sync con config_store
- `types.ts` — PromptSlot, PromptRecord, CompositorPrompts, PromptsService
- `pg-queries.ts` — CRUD para prompt_slots + ALTER campaigns (match_phrases, threshold, prompt_context)
- `prompts-service.ts` — PromptsServiceImpl con cache Map, seed desde archivos/defaults, generación evaluador
- `campaign-matcher.ts` — CampaignMatcher con fuse.js fuzzy matching por frases

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: [] (llm es opcional, solo para generar evaluador)

## Tabla DB: prompt_slots
- `id` UUID PK, `slot` TEXT, `variant` TEXT, `content` TEXT, `is_generated` BOOLEAN, timestamps
- UNIQUE (slot, variant)
- Slots: identity, job, guardrails, relationship, evaluator
- Variants: 'default' para la mayoría; relationship tiene 'lead', 'admin', 'coworker', 'unknown'

## Tabla DB: campaigns (columnas agregadas)
- `match_phrases` JSONB, `match_threshold` REAL, `prompt_context` TEXT

## Servicio expuesto
- `prompts:service` — PromptsService interface

## API Routes (bajo /oficina/api/prompts/)
- GET/PUT slots, POST generate-evaluator, CRUD campaigns

## Trampas
- `db` es `readonly` público en PromptsServiceImpl — API routes lo acceden directamente
- Campaign match usa score invertido: fuse.js 0=perfecto → matchScore = 1 - score
- `invalidateCache()` recarga async — breve momento sin cache
- Si tabla campaigns no existe, queries fallan silenciosamente
