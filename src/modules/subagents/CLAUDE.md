# Módulo: subagents — Subagentes especializados

CRUD de tipos de subagent configurables desde consola. Expone catálogo al engine via `subagents:catalog`.

## Archivos
- `manifest.ts` — module manifest, console (grupo: agent), API routes (CRUD + usage)
- `types.ts` — SubagentTypeRow, SubagentCatalogEntry, SubagentUsageSummary, etc.
- `repository.ts` — CRUD subagent_types + tracking subagent_usage (raw SQL)
- `service.ts` — SubagentsCatalogService: cache in-memory, reload, getBySlug
- `templates.ts` — HTML templates para consola (cards, editor, badges)

## Manifest
- type: `feature`, depends: `['llm']`
- console group: `agent` (aparece bajo menú de agente)
- Sin configSchema (la config vive en la tabla subagent_types, no en env vars)

## Servicio: `subagents:catalog`
```typescript
getEnabledTypes(): SubagentCatalogEntry[]  // Para Phase 2 (prompt)
getBySlug(slug): SubagentCatalogEntry | null  // Para Phase 3 (ejecución)
recordUsage(record): Promise<void>  // Tracking fire-and-forget
getUsageSummary(period): Promise<SubagentUsageSummary>  // Para consola
reload(): Promise<void>  // Recarga cache desde DB
```

## System Subagents (`is_system = true`)
- No se pueden eliminar (API retorna 403)
- Campos protegidos no editables: slug, name, modelTier, verifyResult, canSpawnChildren, allowedTools, systemPrompt, googleSearchGrounding
- Campos editables: enabled, tokenBudget, description, sortOrder, allowedKnowledgeCategories
- UI muestra badge "Sistema" y deshabilita campos protegidos
- Seed: `web-researcher` (migración 018)

## Web Researcher (subagente de sistema)
- Slug: `web-researcher`, Google Search Grounding habilitado
- Centraliza búsqueda web: Phase 3 redirige `web_search` steps al web-researcher si está habilitado
- Tools: `web_explore`, `search_knowledge`
- Verificación + spawn habilitados

## Verificación iterativa
- `MAX_VERIFY_RETRIES = 3` (antes 1)
- Loop: verify → accept/retry/fail. En retry, continúa la conversación (no empieza de cero)
- El verificador se vuelve más estricto en intentos posteriores

## Tablas (migraciones 013 + 018)
- `subagent_types` — CRUD + `is_system`, `google_search_grounding`
- `subagent_usage` — tracking: iterations, tokens_used, duration_ms, success, verified, cost_usd

## Trampas
- Cache in-memory se recarga con `reload()` después de cada CRUD
- `allowed_tools` es TEXT[] en PG — se pasa como array JS directo
- `token_budget` tiene CHECK >= 5000 en DB y validación en API
- Slug debe ser kebab-case: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`
- Si el módulo no está activo, el engine cae a legacy subagent (backward compat)
- `deleteType()` retorna `{ deleted, isSystem }` — verificar antes de 403
- `updateType()` filtra campos protegidos si `isSystem=true`
