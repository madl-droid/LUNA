# Lead Scoring — Sistema de calificacion de leads (v3)

Preset unico por tenant: califica leads con CHAMP (B2B), SPIN (B2C) o CHAMP+Gov (B2G). Sin multi-framework ni deteccion de client_type. Pesos por prioridad (high/medium/low), scoring por codigo, extraccion por LLM, UI en console.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (apiRoutes), servicios
- `types.ts` — QualifyingCriterion (priority, enumScoring), QualifyingConfig (single-fw), ExtractionResult, generateKeyFromName()
- `frameworks.ts` — PresetDefinition, CHAMP_PRESET, SPIN_PRESET, CHAMP_GOV_PRESET (max 10 criterios c/u), PRESETS registry, getPreset()
- `scoring-engine.ts` — calculateScore(), buildQualificationSummary(), getCurrentStage(), mergeQualificationData() (con timestamps), resolveTransition(), isFilled()
- `config-store.ts` — lee/escribe instance/qualifying.json, migracion 3 formatos (v1 BANT plano, v2 multi-fw, v3 single-fw), applyPreset(), addCriterion(), removeCriterion()
- `extract-tool.ts` — tool `extract_qualification`: LLM extraction, prompt caching por fingerprint, dynamic tool description
- `pg-queries.ts` — queries: listar leads, detalle, actualizar score, recalcular batch, stats
- `templates.ts` — SSR HTML: single-fw card con objetivo, criterios con prioridad, comportamiento

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: LEAD_SCORING_CONFIG_PATH (default: `instance/qualifying.json`)

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries

## Scoring v3
- Pesos calculados en runtime desde `priority`: high=3, medium=2, low=1
- Normalizado a 100 automaticamente — agregar/quitar criterios no rompe nada
- EnumScoring: `indexed` (default, escala) vs `presence` (sin orden semantico)
- `_extracted_at[key]` guarda timestamps de extraccion por campo (base para decay)
- Config max 10 criterios

## Formato config (v3) — instance/qualifying.json
```json
{
  "preset": "spin",
  "objective": "schedule",
  "stages": [...],
  "criteria": [{ "key": ..., "priority": "high|medium|low", "enumScoring"?: "presence", ... }],
  "disqualifyReasons": [...],
  "essentialQuestions": ["key1", "key2"],
  "thresholds": { "cold": 30, "qualifying": 31, "qualified": 70 },
  "minConfidence": 0.4,
  "dataFreshnessWindowDays": 90
}
```

## Migracion automatica de formatos
El config-store detecta y migra al cargar:
- Formato 1 (BANT plano): `criteria` en root, sin `frameworks` ni `preset` → migra con preset='spin'
- Formato 2 (multi-fw v2): tiene `frameworks[]` → toma primer framework activo
- Formato 3 (v3): tiene `preset` → carga directo

## API routes (montadas en /console/api/lead-scoring/)
- `GET /config` — config actual
- `PUT /config` — guardar config nueva
- `GET /presets` — listar presets disponibles
- `POST /apply-preset` — aplicar preset (reemplaza criterios/stages)
- `POST /recalculate` — recalcular scores batch
- `GET /stats`, `GET /stats-detailed`, `GET /leads`, `GET /lead`, `PUT /lead-status`, `POST /disqualify`

## Integracion con context-builder
- `buildQualificationSummary(qualData, config, lang)` — sin parametro de framework
- Inyectado en prompt por context-builder.ts cuando contact_type='lead'

## Trampas
- Config en instance/qualifying.json (JSON), NO en .env
- `resolveFramework()` eliminado — no importar de scoring-engine.ts
- `FrameworkType`/`ClientType`/`FrameworkConfig` eliminados de types.ts — no usar
- `_disqualified` campo reservado en qualification_data
- Prompt cache key = `${preset}:${JSON.stringify(criteria.map(c => c.key))}`
- Helpers HTTP: jsonResponse, parseBody, parseQuery de kernel/http-helpers.js
