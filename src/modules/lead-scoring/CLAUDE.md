# Lead Scoring — Sistema de calificacion de leads

Califica leads usando frameworks predefinidos (CHAMP B2B, SPIN B2C, CHAMP+Gov B2G) o criterios custom. Extraccion natural por LLM, scoring por codigo, UI personalizable en console.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console (apiRoutes), servicios
- `types.ts` — FrameworkType, FrameworkStage, QualifyingConfig, ScoreResult, AutoSignalDefinition
- `frameworks.ts` — presets CHAMP, SPIN, CHAMP+Gov con stages, criterios y disqualify reasons
- `scoring-engine.ts` — motor de scoring: calcula puntos por stage, transiciones, merge de datos, getCurrentStage()
- `config-store.ts` — lee/escribe instance/qualifying.json, hot-reload, applyFramework(), validacion
- `extract-tool.ts` — tool `extract_qualification` con prompts conscientes de framework/stage
- `pg-queries.ts` — queries: listar leads, detalle, actualizar score, recalcular batch, stats
- `templates.ts` — SSR HTML: selector de framework, criterios agrupados por stage, auto signals

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: LEAD_SCORING_CONFIG_PATH (default: `instance/qualifying.json`)

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries

## Hook consumido
- `console:config_applied` — recarga qualifying.json, recalcula scores si config cambio

## Hook emitido
- `contact:status_changed` — cuando cambia qualification_status de un lead

## Frameworks disponibles
- `champ` — B2B: Challenges, Authority, Money, Prioritization (16 criterios, 4 stages)
- `spin` — B2C: Situation, Problem, Implication, Need-payoff (16 criterios, 4 stages)
- `champ_gov` — B2G: CHAMP + Process Stage + Compliance Fit (24 criterios, 6 stages)
- `custom` — criterios manuales sin framework (backward compatible con BANT)

## Tool registrada
- `extract_qualification` — extrae datos del mensaje via LLM, consciente del framework y stage actual

## API routes (montadas en /console/api/lead-scoring/)
- `GET /config` — config actual de qualifying.json
- `PUT /config` — guardar config nueva
- `POST /apply-framework` — aplicar un framework preset (reemplaza criterios)
- `GET /frameworks` — listar presets disponibles
- `POST /recalculate` — recalcular scores de todos los leads
- `GET /stats` — estadisticas por status
- `GET /leads?status=X&search=Y&limit=50&offset=0&sort=score&dir=desc` — lista paginada
- `GET /lead?id=X` — detalle de lead (canales, mensajes, datos)
- `PUT /lead-status` — cambiar status manualmente
- `POST /disqualify` — descalificar lead con motivo
- `GET /ui` — servir HTML de la tab

## Integracion con pipeline
- Phase 3: tool `extract_qualification` se ejecuta cuando el evaluador detecta info relevante
- Phase 5: transicion automatica `new → qualifying` en primera interaccion

## Patrones
- Scoring es 100% codigo — LLM extrae, codigo decide
- Weights se normalizan a 100 si no suman 100
- Enum scoring: opciones ordenadas de peor a mejor (indice/total)
- `_disqualified` en qualification_data = lead descalificado
- `_confidence` en qualification_data = tracking de confianza por campo
- Recalculacion batch usa transaccion SQL
- getCurrentStage() determina la etapa con campos pendientes para enfocar extraccion
- Auto signals: senales calculadas por codigo (engagement, geo, canal, historial, horario), peso configurable

## Trampas
- Config se guarda en instance/qualifying.json (archivo JSON), NO en .env
- Max 10 criterios para custom framework; presets no tienen limite
- Tool solo se registra si modulo tools esta activo (depends: ['tools'])
- Al aplicar framework preset se reemplazan criterios y disqualifyReasons pero se conservan thresholds y actions
- Configs viejas sin campo `framework` se migran automaticamente a `framework: 'custom'`
- **Helpers HTTP y config**: usa `jsonResponse`, `parseBody`, `parseQuery` de `kernel/http-helpers.js`. NO redefinir localmente.
