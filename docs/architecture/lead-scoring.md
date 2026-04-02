# LUNA — Lead Scoring: Arquitectura

> Sistema de calificación de leads con frameworks predefinidos (CHAMP, SPIN, CHAMP+Gov) o criterios custom.

## Principio central

**LLM extrae datos, código decide score.** El scoring es 100% determinístico — sin LLM en la calificación.

## Componentes

```
src/modules/lead-scoring/
├── manifest.ts           — lifecycle, API routes, servicios
├── types.ts              — QualifyingConfig, ScoreResult, LeadSummary, etc.
├── frameworks.ts         — presets CHAMP (B2B), SPIN (B2C), CHAMP+Gov (B2G)
├── scoring-engine.ts     — calculateScore, getCurrentStage, resolveTransition
├── config-store.ts       — lee/escribe instance/qualifying.json
├── extract-tool.ts       — tool extract_qualification (LLM extraction)
├── pg-queries.ts         — CRUD de leads en agent_contacts
├── templates.ts          — UI SSR para la console
```

La gestión de campañas fue movida al módulo `src/modules/marketing-data/`.

## Frameworks disponibles

| Framework | Tipo | Stages | Criterios | Uso |
|-----------|------|--------|-----------|-----|
| CHAMP | B2B | 4 (Challenges→Authority→Money→Prioritization) | 16 | Ventas empresariales |
| SPIN | B2C | 4 (Situation→Problem→Implication→Need-payoff) | 16 | Ventas a consumidor |
| CHAMP+Gov | B2G | 6 (CHAMP + licitaciones + compliance) | ~24 | Ventas al gobierno |
| Custom | Libre | Definidos por usuario | Max 10 | Casos específicos |

## Scoring engine

### Cálculo de score (0-100)

1. Pesos se normalizan para sumar 100
2. Cada criterio se evalúa según tipo:
   - **enum**: `(index + 1) / opciones.length` (ej: "high" en [low, medium, high] = 100%)
   - **boolean**: puntos completos si `true`, 0 si `false`
   - **text/number**: puntos completos si tiene valor
3. Score total = suma ponderada de criterios
4. Auto-signals (engagement, geo_fit, etc.) suman puntos configurables

### Máquina de estados

```
new → qualifying / cold / out_of_zone / not_interested / blocked
qualifying → qualified / cold / out_of_zone / not_interested / blocked
qualified → scheduled / blocked
scheduled → attended / cold / blocked
attended → converted / blocked
converted → blocked
out_of_zone / not_interested / cold → qualifying / blocked
```

Transiciones válidas forzadas por `resolveTransition()`. Estado "blocked" es terminal.

### Umbrales (configurables)

- `score ≥ qualified` + sin required faltantes → **qualified**
- `score ≤ cold` → **cold**
- Entre ambos → **qualifying**

Disqualificación via `_disqualified` key → estado terminal según razón.

## Tool: extract_qualification

- **Nombre**: `extract_qualification`
- **Trigger**: Phase 2 cuando el evaluador detecta info relevante para calificación
- **Input**: `message_text` + `contact_id`
- **Modelo**: LLM vía `llm:chat` (temp=0.1, max 500 tokens)
- **Prompt**: framework-aware, muestra stage actual y campos ya completados como `[ALREADY KNOWN]`
- **Merge**: solo sobreescribe si confianza > `minConfidence` (default 0.3)
- **Confianza**: tracked per-field en `_confidence` dict
- **Seguridad**: `FOR UPDATE` lock durante merge (previene race conditions)
- **Hook**: emite `contact:status_changed` si hay transición de estado

## Campañas

### Modelo

Cada campaña tiene:
- `keyword` (1 por campaña) — matched con fuse.js fuzzy (threshold configurable, default 0.95)
- `allowedChannels` — filtro de canales (vacío = todos menos voice)
- `matchMaxRounds` — máximo de rondas de conversación para matchear (1-3)
- `promptContext` — contexto inyectado al compositor Phase 4 (max 200 chars)
- `tags` — platform (Google Ads, Meta, etc.) + source (orgánico, referido, etc.)

### Atribución

- Se registra en `contact_campaigns` (contact ↔ campaign ↔ session)
- Conversión atribuida a la **última** campaña del contacto
- Stats: entries (contactos únicos) y conversions (leads que llegan a qualified)

## Almacenamiento

| Dato | Tabla | Campo |
|------|-------|-------|
| Criterios extraídos | `agent_contacts` | `qualification_data` (JSONB) |
| Score | `agent_contacts` | `qualification_score` (int 0-100) |
| Estado | `agent_contacts` | `lead_status` |
| Campañas | `campaigns` | + `campaign_tags`, `campaign_tag_assignments` |
| Historial | `contact_campaigns` | contact ↔ campaign con score y canal |

## Servicios expuestos

| Servicio | Descripción |
|----------|-------------|
| `lead-scoring:config` | ConfigStore — lee/escribe qualifying.json |
| `lead-scoring:queries` | LeadQueries — CRUD de leads |
| `lead-scoring:campaign-queries` | CampaignQueries — CRUD de campañas |
| `lead-scoring:match-campaign` | Función de matching (text, channel) → CampaignMatchResult |
| `lead-scoring:reload-campaigns` | Recarga índice de campañas |

## Config: instance/qualifying.json

```json
{
  "framework": "champ",
  "stages": [...],
  "criteria": [{ "key": "main_problem", "type": "text", "weight": 10, "required": true, "stage": "challenges" }],
  "thresholds": { "cold": 15, "qualifying": 0, "qualified": 60 },
  "qualifiedActions": ["scheduled", "escalate_human"],
  "defaultQualifiedAction": "scheduled",
  "disqualifyReasons": [{ "key": "no_budget", "name": "Sin presupuesto", "targetStatus": "not_interested" }],
  "autoSignals": [{ "key": "engagement", "weight": 5 }],
  "minConfidence": 0.3
}
```

**Validaciones**: weights suman 100, enum criteria tienen options, cold < qualified threshold, stages definidos.

## Hot-reload

Cambio de config en console → hook `console:config_applied` → recarga config → recalculate batch si cambió criteria/thresholds.

## API Routes (bajo /console/api/lead-scoring/)

| Método | Path | Descripción |
|--------|------|-------------|
| GET | /config | Config actual |
| PUT | /config | Guardar config |
| POST | /apply-framework | Aplicar preset |
| GET | /frameworks | Listar presets disponibles |
| POST | /recalculate | Recalcular todos los leads |
| GET | /stats | Resumen por status |
| GET | /stats-detailed | Métricas con filtros |
| GET | /leads | Lista paginada con búsqueda |
| GET | /lead | Detalle completo |
| PUT | /lead-status | Cambio manual de status |
| POST | /disqualify | Disqualificar con razón |
| GET/POST/PUT/DELETE | /campaign* | CRUD campañas |
| GET/POST/PUT/DELETE | /tag* | CRUD tags |
