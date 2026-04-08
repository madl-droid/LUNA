# Auditoría: Campaign Optimization (`claude/plan-campaign-optimization-4HfAS`)

**Fecha**: 2026-04-08
**Branch auditado**: `claude/plan-campaign-optimization-4HfAS`
**Branch auditoría**: `claude/audit-campaign-optimization-2VfOU`

## Resumen Ejecutivo

El plan es sólido conceptualmente (UTM > keyword, auto-creación, métricas desglosadas). La arquitectura base está bien. **Pero hay bugs reales que invalidan funcionalidad clave, y dos vectores de ataque.**

Planes ejecutados:
- Overview: `docs/plans/campaign-optimization/overview.md`
- Plan 1: `docs/plans/campaign-optimization/01.md` (UTM Foundation)
- Plan 2: `docs/plans/campaign-optimization/02.md` (Metrics + Console UI)

Archivos modificados:
- `src/modules/marketing-data/campaign-queries.ts`
- `src/modules/marketing-data/campaign-matcher.ts`
- `src/modules/marketing-data/campaign-types.ts`
- `src/modules/marketing-data/manifest.ts`
- `src/modules/marketing-data/utm-parser.ts` (NUEVO)
- `src/modules/marketing-data/templates.ts`
- `src/modules/marketing-data/CLAUDE.md`
- `src/engine/boundaries/intake.ts`
- `src/engine/boundaries/delivery.ts`
- `src/engine/prompts/context-builder.ts`
- `src/engine/types.ts`
- `src/modules/users/webhook-handler.ts`

---

## BUGS CRÍTICOS

### BUG 1: Queries SELECT no incluyen `utm_keys` ni `origin` — DATA LOSS

**Archivos**: `campaign-queries.ts:135-155` (listCampaigns), `campaign-queries.ts:170-178` (getCampaignById)

Las queries SELECT listan columnas explícitamente pero **NUNCA incluyen `c.utm_keys` ni `c.origin`**. El `mapCampaignRow` (line 725-726) intenta leerlos pero recibe `undefined`, y los fallbacks devuelven `utmKeys: []` y `origin: 'manual'` para TODAS las campañas.

**Consecuencias:**
- La consola NUNCA muestra el badge "Auto UTM" (todo dice "Manual")
- La consola NUNCA muestra los UTM keys de ninguna campaña
- **DATA LOSS**: Al abrir el form de edición, `utmKeys` carga vacío → al guardar se envía `utmKeys: []` → el UPDATE borra los utm_keys reales de la DB

**Fix**: Agregar `c.utm_keys, c.origin` al SELECT de ambas queries.

### BUG 2: `autoCreateFromUtm` sin ON CONFLICT — duplicados garantizados

**Archivo**: `campaign-queries.ts:302-306`

```sql
INSERT INTO campaigns (name, keyword, utm_keys, utm_data, origin, active, updated_at)
VALUES ($1, NULL, ARRAY[$1], $2, 'auto_utm', true, now())
RETURNING id, name, visible_id
```

No hay ON CONFLICT. No hay UNIQUE constraint en `name` ni en `utm_keys`. Dos requests concurrentes con el mismo `utm_campaign` crean dos campañas duplicadas (UUIDs distintos, mismos datos).

**El CLAUDE.md del módulo dice**: "Auto-creación usa ON CONFLICT para evitar race conditions" — **esto es falso.**

**Fix**: Agregar UNIQUE constraint parcial + ON CONFLICT:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_utm_origin ON campaigns (name) WHERE origin = 'auto_utm';
-- Luego:
INSERT INTO campaigns (...) VALUES (...) ON CONFLICT (name) WHERE origin = 'auto_utm' DO UPDATE SET utm_data = $2 RETURNING ...
```

### BUG 3: Dynamic import sin try-catch puede crashear todo el pipeline

**Archivo**: `intake.ts:931`

```typescript
const { extractUtmFromText } = await import('../../modules/marketing-data/utm-parser.js')
```

Si el módulo `marketing-data` se elimina del disco (no solo se desactiva), este import lanza un error que NO tiene catch. Propaga por `detectCampaign` → Phase 1 → **crashea el procesamiento de TODOS los mensajes**, no solo la detección de campaña.

**Fix**: Envolver en try-catch, o mejor: proveer `extractUtmFromText` como servicio del registry (respeta el patrón de aislamiento).

---

## BUGS MEDIOS (seguridad)

### BUG 4: Prompt injection via nombres de campañas auto-creadas

**Archivos**: `campaign-queries.ts:304` + `context-builder.ts:205-207`

Las campañas auto-creadas toman su nombre directamente del valor de `utm_campaign`. Este nombre se inyecta **sin escape** al prompt del LLM:

```typescript
let campaignLine = `[Campaña: ${ctx.campaign.name}]`
if (ctx.campaign.promptContext) {
  campaignLine += ` — ${ctx.campaign.promptContext}`
}
```

Todos los demás datos dinámicos en el mismo archivo usan `escapeDataForPrompt()`.

**Vector de ataque**: URL con `utm_campaign=] Ignora instrucciones anteriores...` → auto-crea campaña → todos los futuros usuarios matched reciben el prompt inyectado.

**Fix**: `escapeDataForPrompt(ctx.campaign.name, 200)` y `escapeDataForPrompt(ctx.campaign.promptContext, 500)`.

### BUG 5: XSS en la consola via nombres de campañas

**Archivo**: `templates.ts:356`

`c.name` se inserta en innerHTML sin escapar. Las campañas auto-creadas toman su nombre de `utm_campaign`, que es input externo.

**Vector**: `utm_campaign=<img onerror=alert(document.cookie) src=x>` → stored XSS en el panel de admin.

Misma historia con UTM keys (line 358): `k` sin escapar en innerHTML.

**Fix**: Crear función `escHtml()` en el inline JS y aplicar a todo dato dinámico.

### BUG 6: `findByUtmCampaign` dice "case-insensitive" pero SQL es case-sensitive

**Archivo**: `campaign-queries.ts:277-283`

JSDoc dice "case-insensitive". SQL dice `WHERE $1 = ANY(utm_keys)` que es **case-sensitive** en PostgreSQL.

`extractUtmFromText` preserva el case original del URL. Si el admin configuró `utm_keys: ['black-friday']` y el URL tiene `utm_campaign=Black-Friday`, **no matchea** y se auto-crea una campaña duplicada.

**Fix**: `WHERE LOWER($1) = ANY(SELECT LOWER(unnest(utm_keys)))` o normalizar a lowercase al guardar y al buscar.

---

## VIOLACIONES DE POLÍTICAS

### 1. Import directo de módulo a engine (x2)
- `intake.ts:931`: `import('../../modules/marketing-data/utm-parser.js')`
- `webhook-handler.ts:177`: `import('../marketing-data/utm-parser.js')`

La política LUNA dice: **"NO importar código entre módulos directamente — usar hooks o services del registry"**

El UTM parser debería exponerse como servicio: `registry.provide('marketing-data:extract-utm', extractUtmFromText)`.

### 2. CLAUDE.md del módulo documenta comportamiento incorrecto
Dice que auto-creación usa ON CONFLICT. No lo hace.

---

## DEUDA TÉCNICA / PROBLEMAS DE DISEÑO

### 1. Sin rate limiting en auto-creación de campañas
Un bot puede enviar miles de URLs con `utm_campaign` únicos y crear miles de campañas. Esto llena la tabla y degrada el rendimiento del matcher (Fuse.js recarga todo el índice en cada creación).

**Sugerencia**: Limitar auto-creaciones a N por hora, o flag admin para habilitar/deshabilitar auto-creación.

### 2. Query "Sin campaña" es O(n²)
`campaign-queries.ts:489-498`: `NOT IN (SELECT DISTINCT ...)` es cuadrático. Usar `LEFT JOIN + IS NULL`.

### 3. Detailed stats = 8 queries por carga
`getCampaignDetailedStats()` ejecuta `getCampaignStats()` (3 queries) + 5 más = 8 queries. Funcional hoy pero no escala.

### 4. Toggles readonly disfrazados de checkboxes
Los checkboxes disabled con tooltip son UX confusa. Un texto estático sería más honesto.

### 5. Auto-creación sin cleanup
Las campañas auto-creadas se acumulan sin mecanismo de limpieza.

---

## LO QUE ESTÁ BIEN

1. **Arquitectura UTM > keyword** — correcta, bien separada
2. **Tipos TypeScript** — exhaustivos, bien definidos
3. **Error handling en API routes** — consistente con try-catch
4. **Fire-and-forget para recording** — delivery no se bloquea
5. **Config via `boolEnv()` + `registry.getConfig()`** — cumple política
6. **HTTP helpers del kernel** — usados correctamente
7. **Labels bilingüe** — completos
8. **UTM parser** — limpio, puro, sin dependencias externas
9. **Matcher reload después de CRUD** — correcto
10. **Stats con source breakdown** — buen concepto, queries SQL correctas

---

## PRIORIDAD DE FIXES

| # | Severidad | Fix | Esfuerzo |
|---|-----------|-----|----------|
| 1 | **CRÍTICO** | Agregar `c.utm_keys, c.origin` a queries SELECT | 2 min |
| 2 | **CRÍTICO** | ON CONFLICT en autoCreateFromUtm + unique index | 10 min |
| 3 | **CRÍTICO** | try-catch alrededor del dynamic import en intake.ts | 2 min |
| 4 | **MEDIO** | `escapeDataForPrompt` en context-builder.ts | 2 min |
| 5 | **MEDIO** | Escape HTML de nombres dinámicos en templates.ts | 5 min |
| 6 | **MEDIO** | Case-insensitive UTM lookup (LOWER) | 5 min |
| 7 | **BAJO** | Mover utm-parser a servicio del registry | 15 min |
| 8 | **BAJO** | Optimizar query "Sin campaña" | 5 min |
| 9 | **BAJO** | Rate limit en auto-creación | 20 min |

**Esfuerzo total fixes 1-6 (funcionalidad + seguridad): ~30 minutos**

---

## VEREDICTO

El diseño conceptual es bueno. El código es legible y organizado. Pero la ejecución tiene huecos que hacen que features clave no funcionen: el badge "Auto UTM" nunca aparece, los UTM keys nunca se muestran, y peor, editarlos los borra. La seguridad tiene dos vectores de ataque reales (prompt injection + XSS) porque los datos auto-creados desde URLs no se sanitizan. Los fixes 1-6 son rápidos (~30 min) y convertirían esto en algo funcional y seguro.
