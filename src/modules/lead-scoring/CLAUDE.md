# Lead Scoring — Sistema de calificacion de leads (v2)

Multi-framework: califica leads usando CHAMP (B2B), SPIN (B2C), CHAMP+Gov (B2G) simultaneamente. Deteccion de tipo de cliente, objectives per-framework, flujo directo. Extraccion natural por LLM, scoring por codigo, UI en console.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (apiRoutes), servicios
- `types.ts` — FrameworkType, ClientType, FrameworkObjective, FrameworkConfig, QualifyingConfig (multi-framework), ExtractionResult, generateKeyFromName()
- `frameworks.ts` — presets CHAMP, SPIN, CHAMP+Gov con stages, criterios, disqualify reasons, essentialQuestions
- `scoring-engine.ts` — motor de scoring: resolveFramework(), calculateScore(), buildQualificationSummary(), directo status
- `config-store.ts` — lee/escribe instance/qualifying.json, multi-framework, setFramework(), resetFrameworkToPreset(), migracion old→new
- `extract-tool.ts` — tool `extract_qualification`: prompt caching, client type detection, conversation buffer, dynamic tool description
- `pg-queries.ts` — queries: listar leads, detalle, actualizar score, recalcular batch, stats (con directo status)
- `templates.ts` — SSR HTML: framework cards con toggle+objetivo, criterios per-framework, comportamiento

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: LEAD_SCORING_CONFIG_PATH (default: `instance/qualifying.json`)

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries
- Campanas movidas al modulo `marketing-data` (servicios: `marketing-data:campaign-queries`, `marketing-data:match-campaign`, `marketing-data:reload-campaigns`)

## Multi-framework
- `frameworks[]` en config: cada uno con type, enabled, objective, stages, criteria, essentialQuestions
- Client type detection: si >1 framework activo, primera extraccion detecta b2b/b2c/b2g
- `_client_type` en qualification_data guarda tipo detectado
- `resolveFramework()` rutea al framework correcto segun client type

## Objectives per-framework
- `schedule` | `sell` | `escalate` | `attend_only`
- Compositor recibe objetivo en espanol para guiar respuestas
- Configurable desde console en cada card de framework

## Flujo directo
- Status `directo`: lead pide accion objetivo antes de completar calificacion
- essentialQuestions (max 2 por framework): preguntas minimas antes de convertir directo
- Estado: new/qualifying → directo → converted/blocked

## Tool registrada
- `extract_qualification` — extraccion con prompt caching, tool description dinamica

## API routes (montadas en /console/api/lead-scoring/)
- `GET /config` — config actual
- `PUT /config` — guardar config nueva
- `POST /set-framework` — enable/disable framework + objective
- `POST /reset-framework` — resetear framework a preset
- `GET /frameworks` — listar presets con estado actual
- `POST /recalculate` — recalcular scores batch
- `GET /stats`, `GET /leads`, `GET /lead`, `PUT /lead-status`, `POST /disqualify`
- Campanas: movidas al modulo `marketing-data`

## Integracion con evaluator/compositor
- Evaluator: recibe `buildQualificationSummary()` en ingles (score, stage, missing, known, essential questions)
- Compositor: recibe summary en espanol + objetivo + neverAskDirectly + instruccion directo
- Tool description: dinamica, refleja frameworks activos y nombres de criterios

## Trampas
- Config en instance/qualifying.json (JSON), NO en .env
- Keys auto-generadas desde name.en via generateKeyFromName() — no edicion manual
- Configs viejas (single framework, custom) se migran automaticamente
- Prompt cache se invalida en cambio de config (clearExtractionPromptCache)
- `_client_type` y `_disqualified` son campos reservados en qualification_data
- Helpers HTTP: usa jsonResponse, parseBody, parseQuery de kernel/http-helpers.js
