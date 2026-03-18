# Lead Scoring — Sistema de calificacion de leads

Califica leads usando BANT + criterios custom. Extraccion natural por LLM, scoring por codigo, UI personalizable en oficina.

## Archivos
- `manifest.ts` — lifecycle, configSchema, oficina (apiRoutes), servicios
- `types.ts` — QualifyingConfig, QualificationStatus, ScoreResult, LeadSummary/Detail
- `scoring-engine.ts` — motor de scoring: calcula puntos, transiciones de estado, merge de datos
- `config-store.ts` — lee/escribe instance/qualifying.json, hot-reload, validacion
- `extract-tool.ts` — tool `extract_qualification` registrada en tools:registry
- `pg-queries.ts` — queries: listar leads, detalle, actualizar score, recalcular batch, stats
- `ui/lead-scoring.html` — SPA tab separada (config + vista de leads)

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['tools']`
- configSchema: LEAD_SCORING_CONFIG_PATH (default: `instance/qualifying.json`)

## Servicios registrados
- `lead-scoring:config` — instancia de ConfigStore
- `lead-scoring:queries` — instancia de LeadQueries

## Hook consumido
- `oficina:config_applied` — recarga qualifying.json, recalcula scores si config cambio

## Hook emitido
- `contact:status_changed` — cuando cambia qualification_status de un lead

## Tool registrada
- `extract_qualification` — extrae datos BANT del mensaje via LLM barato, actualiza DB

## API routes (montadas en /oficina/api/lead-scoring/)
- `GET /config` — config actual de qualifying.json
- `PUT /config` — guardar config nueva
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

## Trampas
- El kernel server necesita el fix de query params (url.split('?')[0]) para que las rutas GET con params funcionen
- Config se guarda en instance/qualifying.json (archivo JSON), NO en .env
- Max 10 criterios (4 BANT + 6 custom)
- Tool solo se registra si modulo tools esta activo (depends: ['tools'])
