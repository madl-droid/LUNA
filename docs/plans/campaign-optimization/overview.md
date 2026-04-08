# OVERVIEW — Campaign Optimization

## Sesion
**Branch planner**: `claude/plan-campaign-optimization-4HfAS`
**Fecha**: 2026-04-08

## Objetivo
Evolucionar el modulo `marketing-data` para soportar deteccion automatica de UTMs, auto-creacion de campanas desde UTMs, metricas desglosadas por fuente, y toggles admin para controlar metodos de deteccion.

## Problema actual
1. `utm_data` JSONB existe en tabla `campaigns` pero es cosmetico (nunca se usa en deteccion)
2. `CampaignInfo.utm` siempre es `null` en deteccion (intake.ts:948)
3. `promptContext` existe pero no se inyecta al LLM (context-builder.ts solo usa nombre)
4. `contact_campaigns` no registra COMO se detecto la campana (keyword vs webhook vs UTM)
5. Webhook no acepta parametros UTM
6. No hay parseo de URLs con UTMs en mensajes entrantes
7. Metricas solo muestran entries + conversions sin dimension de fuente/medio

## Principio de diseno

```
UTM = fuente de verdad (automatico, tracking real)
Keyword = backup (cuando no hay UTM, deteccion por mensaje)
UTM SIEMPRE GANA sobre keyword
```

### Prioridad de deteccion
```
1. UTM (si habilitado): parsear URLs en mensaje o utm en webhook
   -> buscar campana por utm_campaign en utm_keys[]
   -> si no existe -> AUTO-CREAR campana
2. Keyword (si habilitado, y solo si UTM no matcheo): fuzzy match por texto
3. Webhook campaign field: solo como backup cuando no hay UTMs
```

### Toggles admin
- `UTM match habilitado` (default: true)
- `Keyword match habilitado` (default: true)
- Configurables desde consola, persistidos en config_store

## Cambios de schema

### Tabla `campaigns` (columnas nuevas)
| Columna | Tipo | Default | Descripcion |
|---------|------|---------|-------------|
| `utm_keys` | `TEXT[]` | `'{}'` | Valores de `utm_campaign` que mapean a esta campana |
| `origin` | `TEXT` | `'manual'` | `'manual'` (creada en consola) o `'auto_utm'` (auto-creada) |

### Tabla `contact_campaigns` (columnas nuevas)
| Columna | Tipo | Default | Descripcion |
|---------|------|---------|-------------|
| `match_source` | `TEXT` | `'keyword'` | `'keyword'` \| `'url_utm'` \| `'webhook'` \| `'webhook_utm'` |
| `utm_data` | `JSONB` | `'{}'` | UTMs capturados: `{utm_source, utm_medium, utm_campaign, ...}` |

## Planes de ejecucion

### Plan 1: UTM Foundation — Detection, Auto-creation, Schema
**Alcance**: Todo el backend: schema, parseo UTM, deteccion dual, auto-creacion de campanas, extension webhook, recording con match_source, toggles admin, promptContext injection.

**Archivos que modifica**:
- `src/modules/marketing-data/campaign-queries.ts` — schema + queries + auto-create
- `src/modules/marketing-data/campaign-matcher.ts` — UTM lookup + dual detection
- `src/modules/marketing-data/campaign-types.ts` — types nuevos
- `src/modules/marketing-data/manifest.ts` — config toggles + servicios actualizados
- `src/modules/marketing-data/utm-parser.ts` — **NUEVO**: utilidad de parseo UTM
- `src/engine/boundaries/intake.ts` — deteccion UTM en URLs de mensajes
- `src/engine/boundaries/delivery.ts` — pasar match_source + utm_data al recording
- `src/engine/types.ts` — CampaignInfo ampliado
- `src/engine/prompts/context-builder.ts` — inyectar promptContext
- `src/modules/users/webhook-handler.ts` — aceptar utm object en body

### Plan 2: Enhanced Metrics + Console UI
**Alcance**: Queries de stats desglosadas, API endpoints nuevos, console UI con breakdown por fuente, badge auto_utm, editor de utm_keys, first-touch attribution, CLAUDE.md updates.

**Archivos que modifica**:
- `src/modules/marketing-data/campaign-queries.ts` — stats queries expandidas
- `src/modules/marketing-data/campaign-types.ts` — tipos de stats nuevos
- `src/modules/marketing-data/templates.ts` — UI: stats desglosados, badge, utm_keys editor, toggles
- `src/modules/marketing-data/manifest.ts` — API routes nuevos
- `src/modules/marketing-data/CLAUDE.md` — actualizar documentacion
- `CLAUDE.md` — actualizar entrada de marketing-data si aplica

## Estrategia de ejecucion

```
Plan 1 (Foundation) ──> Plan 2 (Metrics + UI)
     SECUENCIAL
```

**Plan 2 depende de Plan 1** porque:
- Las queries de stats usan las columnas `match_source` y `utm_data` creadas en Plan 1
- La UI muestra campos (`utm_keys`, `origin`, toggles) que Plan 1 introduce en el schema
- Los API routes nuevos llaman metodos que Plan 1 agrega a campaign-queries

**NO se pueden paralelizar.**

## Validacion post-ejecucion
1. TypeScript compila sin errores (`npx tsc --noEmit`)
2. Webhook acepta UTMs y auto-crea campanas
3. Mensajes con URLs con UTMs detectan campana correctamente
4. Keyword match funciona como backup cuando UTM no matchea
5. Toggles desactivan/activan cada metodo de deteccion
6. Metricas muestran breakdown por match_source
7. Console muestra badge auto_utm, editor utm_keys, stats desglosadas
8. promptContext se inyecta al LLM cuando hay campana
