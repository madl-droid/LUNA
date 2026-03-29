# Módulo: subagents — Subagentes especializados

CRUD de tipos de subagent configurables desde consola. Expone catálogo al engine via `subagents:catalog`.

## Archivos
- `manifest.ts` — module manifest, console (grupo: agent), API routes (CRUD + usage)
- `types.ts` — SubagentTypeRow, SubagentCatalogEntry, SubagentUsageSummary, etc.
- `repository.ts` — CRUD subagent_types + tracking subagent_usage (raw SQL)
- `service.ts` — SubagentsCatalogService: cache in-memory, reload, getBySlug

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

## API Routes (`/console/api/subagents/`)
- `GET types` — lista todos los tipos
- `GET type?id=` — detalle de un tipo
- `POST type` — crear tipo (slug + name requeridos)
- `PUT type` — actualizar tipo (id requerido)
- `DELETE type?id=` — eliminar tipo
- `GET usage?period=day|week|month|hour` — métricas agregadas
- `GET available-tools` — lista tools disponibles (para selector en consola)

## Tablas (migración 013)
- `subagent_types` — CRUD, campos: slug, name, description, enabled, model_tier, token_budget, verify_result, can_spawn_children, allowed_tools, system_prompt
- `subagent_usage` — tracking: iterations, tokens_used, duration_ms, success, verified, cost_usd

## Trampas
- Cache in-memory se recarga con `reload()` después de cada CRUD
- `allowed_tools` es TEXT[] en PG — se pasa como array JS directo
- `token_budget` tiene CHECK >= 5000 en DB y validación en API
- Slug debe ser kebab-case: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`
- Si el módulo no está activo, el engine cae a legacy subagent (backward compat)
