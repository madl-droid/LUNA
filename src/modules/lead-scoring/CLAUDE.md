# Lead Scoring — Sistema de calificacion de leads (v3)

Califica leads usando un framework configurable (presets: CHAMP/SPIN/CHAMP+Gov o custom).
Un framework activo por tenant. Extraccion code-only (sin LLM interno), scoring deterministico,
decay temporal, priority weights. UI en console.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (apiRoutes), servicios
- `types.ts` — QualifyingConfig, QualifyingCriterion (priority-based), QualificationStatus, ScoreResult
- `frameworks.ts` — presets CHAMP, SPIN, CHAMP+Gov (max 10 criterios cada uno)
- `scoring-engine.ts` — calculateScore(), buildQualificationSummary(), temporal decay, transition validation
- `config-store.ts` — lee/escribe instance/qualifying.json, migraciones old→v3, apply preset
- `extract-tool.ts` — tool `extract_qualification`: recibe datos estructurados del agentic loop, merge + score (CERO LLM)
- `pg-queries.ts` — queries paginadas: listar leads, detalle, actualizar score, recalcular batch (paginated), stats
- `templates.ts` — SSR HTML: preset selector, criterios con priority y enumScoring, comportamiento con freshness

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries

## Extraccion (Zero-LLM)
- Tool `extract_qualification` recibe `{ extracted, confidence, disqualify_reason? }` del agentic loop
- NO hace llamadas LLM internas. Solo merge transaccional + calculateScore + transition
- El agentic loop extrae datos naturalmente y los pasa como parametros del tool
- Keys que no coinciden con criterios configurados se ignoran silenciosamente

## Scoring
- Pesos por prioridad: high=3, medium=2, low=1 → normalizados a 100
- Enum scoring: 'indexed' (posicion = calidad) o 'presence' (cualquier valor = full score)
- Decay temporal: datos pierden relevancia linealmente (100%→30% en dataFreshnessWindowDays)
- Timestamps en `_extracted_at` por campo

## Config (instance/qualifying.json)
- `preset`: preset base ('champ', 'spin', 'champ_gov', null)
- `objective`: 'schedule' | 'sell' | 'escalate' | 'attend_only'
- `criteria[]`: max 10, con priority en vez de weight
- `thresholds`: cold/qualifying/qualified
- `minConfidence`: default 0.4
- `dataFreshnessWindowDays`: default 90

## Migracion automatica de formatos
- Formato 1 (BANT plano): sin `preset` ni `frameworks` → migra con preset='spin'
- Formato 2 (multi-fw v2): tiene `frameworks[]` → toma primer framework activo
- Formato 3 (v3): tiene `preset` → carga directo

## API routes (montadas en /console/api/lead-scoring/)
- `GET /config`, `PUT /config`, `GET /presets`, `POST /apply-preset`
- `POST /recalculate`, `GET /stats`, `GET /stats-detailed`
- `GET /leads`, `GET /lead`, `PUT /lead-status`, `POST /disqualify`

## Batch recalc
- `getAllLeadsForRecalc()` pagina internamente (200 por batch, cap 10000)
- Excluye solo 'blocked' y 'converted' (estados terminales)
- 'directo' SI se recalcula (puede cambiar con nueva config)

## Trampas
- Config en instance/qualifying.json (JSON), NO en .env
- Keys auto-generadas desde name.en via generateKeyFromName()
- Configs viejas (BANT plano, multi-framework v2) se migran automaticamente a v3
- `_extracted_at`, `_confidence` y `_disqualified` son campos reservados en qualification_data
- Max 10 criterios por tenant
- Helpers HTTP: usa jsonResponse, parseBody, parseQuery de kernel/http-helpers.js
