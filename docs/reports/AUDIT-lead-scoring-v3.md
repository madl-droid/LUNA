# AUDITORÍA — Branch `claude/plan-grading-optimization-CeYpN`
## Lead Scoring v3: Simplificación, Zero-LLM, Decay Temporal

**Fecha:** 2026-04-09
**Auditor:** Claude Opus 4.6
**Scope:** 22 archivos, ~2300 líneas añadidas, ~1750 eliminadas
**Planes ejecutados:** 3 (Core, Extracción, Console+Docs)

---

## VEREDICTO GENERAL

**La dirección es correcta. La ejecución es buena, con defectos concretos que se deben arreglar.**

La refactorización cumple su objetivo principal: eliminar complejidad innecesaria (multi-framework, detección LLM de client_type, nightly scoring con LLM) y reemplazarla con un sistema más simple y eficiente. El cerebro digital ahora decide por código lo que antes desperdiciaba tokens LLM decidiendo. Eso es un win claro.

Sin embargo, hay bugs reales, gaps de ejecución, y deuda técnica que no se puede ignorar.

---

## BUGS (cosas que van a tronar)

### BUG-1: CRITICAL — XSS en `openDetail()` vía `contactId` inyectado raw en HTML
**Archivo:** `src/modules/lead-scoring/ui/lead-scoring.html:~1135`
```javascript
return `<tr onclick="openDetail('${l.contactId}')">
```
El `contactId` viene del servidor y se inyecta directo en un atributo `onclick` sin escapar. Si un contactId contiene `')` + JS malicioso, se ejecuta. Lo mismo en el botón:
```javascript
onclick="event.stopPropagation();openDetail('${l.contactId}')"
```
**Fix:** Usar `esc(l.contactId)` o mejor: usar `data-id` attributes y event delegation en vez de inline onclick con string interpolation.

### BUG-2: HIGH — `mergeQualificationData()` — condición de confidence tracking invertida
**Archivo:** `src/modules/lead-scoring/scoring-engine.ts:~331-334`
```typescript
for (const [key, conf] of Object.entries(confidence)) {
    if (key.startsWith('_') || merged[key] === extracted[key]) {
      acceptedConf[key] = conf
    }
}
```
La condición `merged[key] === extracted[key]` intenta verificar si el valor fue adoptado. Pero:
1. Si el valor existente era el mismo que el extraído, `merged[key]` igualará `extracted[key]` aunque NO se haya procesado en el loop anterior (el valor era pre-existente).
2. Para objetos/arrays, `===` compara referencia, no valor — siempre será `false`.

**Resultado:** La confidence de campos que ya tenían el mismo valor se sobreescribe incorrectamente, y la de campos con valores complejos nunca se actualiza.

**Fix:** Trackear qué keys realmente se adoptaron en el loop principal (un `Set<string>`) y usarlo en el loop de confidence.

### BUG-3: HIGH — Tool description NO se actualiza cuando cambia la config
**Archivo:** `src/modules/lead-scoring/manifest.ts:~373`
El hook `console:config_applied` hace `store.reload()` y recalcula scores, pero **NO re-registra el tool**. La description del tool `extract_qualification` se construye una sola vez en `registerExtractionTool()` con los criterios activos. Si el admin cambia criterios, el LLM sigue viendo la description vieja con criterios que ya no existen (o sin los nuevos).

El Plan 2 lo identifica explícitamente como pendiente:
> "La descripción del tool se construye una vez al registrar... necesitamos actualizar la descripción."

No se implementó.

**Fix:** Llamar `registerExtractionTool(registry, configStore)` en el hook `console:config_applied` después del reload. Verificar que `registerTool()` permita sobreescribir tools existentes.

### BUG-4: MEDIUM — `calculateCriterionPoints()` da 50% score a enums con valor no reconocido
**Archivo:** `src/modules/lead-scoring/scoring-engine.ts:~192-195`
```typescript
// Presence mode: full points if any valid option is set
if (criterion.enumScoring === 'presence') {
    return idx !== -1 ? maxPoints : maxPoints * 0.5
}
// Indexed mode (default): higher index = better score
if (idx === -1) return maxPoints * 0.5  // unknown option gets half
```
Si el LLM extrae un valor que no está en las `options` del enum (typo, sinónimo, valor libre), el lead recibe **50% de los puntos de ese criterio**. Eso infla el score artificialmente. Un valor no reconocido debería valer 0, no 50%.

**Fix:** Cambiar `maxPoints * 0.5` a `0` para valores no reconocidos en ambos modos. Si se quiere ser generoso, dar 0.1 como máximo.

### BUG-5: MEDIUM — Nightly batch scoring usa OFFSET pagination (anti-pattern)
**Archivo:** `src/engine/proactive/jobs/nightly-batch.ts:~131-137`
```sql
ORDER BY ac.updated_at DESC
LIMIT $1 OFFSET $2
```
Si un row se actualiza (score recalculado → `updated_at = NOW()`) durante la iteración, el ORDER cambia y leads se saltan o procesan doble. Con 1000 leads esto es un race condition real.

**Fix:** Usar cursor-based pagination con `WHERE ac.updated_at < $lastSeen` o `WHERE ac.contact_id > $lastId ORDER BY ac.contact_id`. El mismo issue existe en `pg-queries.ts:getAllLeadsForRecalc()` pero ahí ordena por `contact_id` que es estable — correcto.

### BUG-6: MEDIUM — `applyPreset()` no actualiza el `objective`
**Archivo:** `src/modules/lead-scoring/config-store.ts:~69-79`
```typescript
applyPreset(presetKey: string): QualifyingConfig {
    const preset = PRESETS[presetKey]
    const newConfig: QualifyingConfig = {
      ...this.config,      // ← preserva el objective actual
      preset: presetKey,
      stages: ...,
      criteria: ...,
    }
```
El spread `...this.config` preserva el `objective` del config anterior. Si el tenant tenía `objective: 'sell'` con SPIN y aplica CHAMP, mantiene `'sell'` aunque CHAMP defaults a `'schedule'`. El plan dice "Preserves objective and thresholds" — ¿es intencional?

**Decisión necesaria:** Si es intencional, documentar. Si no, agregar `objective: preset.defaultObjective` al newConfig.

---

## GAPS (lo que se planeó y no se ejecutó)

### GAP-1: HIGH — No se elimina `resolveFramework()` de las exportaciones del viejo scoring-engine
**Plan 1, sección 4:** "Eliminar: `resolveFramework()`"
El Plan 1 dice eliminar `resolveFramework()` completamente del scoring-engine. El branch lo eliminó correctamente — ya no existe en el código nuevo. Pero verificar que ningún otro módulo fuera de lead-scoring lo importaba. En context-builder la referencia se actualizó correctamente.
**Status:** ✅ Ejecutado correctamente.

### GAP-2: MEDIUM — No se re-registra el tool en hot-reload
Ya documentado en BUG-3. El plan lo identifica como pendiente y deja la decisión al ejecutor. El ejecutor no lo resolvió.

### GAP-3: LOW — Prompt files vaciados pero no eliminados
**Plan 2, sección 5:** `cold-lead-scoring.md` y `lead-scoring-extraction.md` quedan como comentarios HTML. El plan dice hacerlo así para evitar errores de carga, pero si el prompt system ya maneja archivos faltantes con fallback, estos archivos fantasma solo confunden.

---

## DEUDA TÉCNICA

### DT-1: HIGH — `getAllLeadsForRecalc()` acumula todos los leads en memoria
**Archivo:** `src/modules/lead-scoring/pg-queries.ts:~244-270`
Pagina con LIMIT/OFFSET pero acumula todo en `allLeads[]` hasta 10,000 leads. Para un tenant con 10K leads, eso es ~10K objetos JSON en memoria (qualification_data puede ser grande). Safety cap ayuda, pero no resuelve el problema.

El plan ofrecía `AsyncGenerator` como alternativa superior. Se eligió la alternativa "más simple". Para la escala actual probablemente funciona, pero es deuda consciente.

### DT-2: MEDIUM — `batchUpdateScores()` hace N queries secuenciales en una transacción
**Archivo:** `src/modules/lead-scoring/pg-queries.ts:~278-300`
Con 10K leads, son 10K `UPDATE` statements individuales dentro de una transacción. Esto bloquea la conexión pool durante minutos. Un `UPDATE ... FROM unnest()` o un batch de 100 con `VALUES` sería órdenes de magnitud más rápido.

### DT-3: MEDIUM — JSON.parse/stringify para deep clone
**Archivo:** `src/modules/lead-scoring/config-store.ts` (múltiples sitios)
Se usa `JSON.parse(JSON.stringify(x))` como deep clone en al menos 8 lugares (presets, config). Funciona pero es lento y pierde tipos. `structuredClone()` existe en Node 22+ y es más eficiente.

### DT-4: LOW — `templates.ts` inyecta config via `JSON.stringify` en template literal
**Archivo:** `src/modules/lead-scoring/templates.ts:~615`
```typescript
var lsConfig = JSON.parse('${JSON.stringify(config).replace(/'/g, "\\'")}')
```
Funciona, pero si `config` contiene `</script>` (improbable pero posible en criterion names), rompe el HTML. Debería usar `JSON.stringify(config).replace(/<\//g, '<\\/')`.

---

## COMPLEJIDAD INNECESARIA

### CI-1: `templates.ts` — SSR + standalone HTML duplicado
Existen DOS sistemas de UI:
- `templates.ts` (~900 líneas): genera HTML SSR para embeber en consola
- `ui/lead-scoring.html` (~1600 líneas): página standalone completa

Ambos hacen lo mismo con código diferente. Esto significa que cada cambio de UI se implementa dos veces. El plan no menciona consolidar esto.

**Sugerencia:** Elegir uno. Si la consola usa SSR, eliminar el standalone (o dejarlo como redirect al embebido). Si el standalone es mejor, eliminar el SSR.

### CI-2: `buildQualificationSummary()` — recalcula score para construir un texto
**Archivo:** `src/modules/lead-scoring/scoring-engine.ts:~344`
Cada vez que el context-builder llama `buildQualificationSummary()`, se ejecuta `calculateScore()` internamente. Si ya se calculó el score antes (ej: en extract-tool), se recalcula redundantemente. Para 10 criterios con decay es <1ms, pero el diseño es wasteful.

**Sugerencia:** Aceptar `ScoreResult` como parámetro opcional. Si ya lo tienes, pásalo; si no, se calcula.

---

## REDUNDANCIAS

### R-1: Función `autoGenerateKey()` en config-store.ts es un wrapper trivial
```typescript
export function autoGenerateKey(nameEn: string): string {
  return generateKeyFromName(nameEn)
}
```
Solo re-exporta `generateKeyFromName` de types.ts. Cualquier caller puede importar directo.

### R-2: `escapeHtml()` definida 2 veces
Definida en `templates.ts:161` y en `ui/lead-scoring.html:1285` con implementaciones ligeramente diferentes (una escapa `>`, la otra no). Si ambos UIs coexisten, al menos deberían ser idénticas.

---

## POLICY VIOLATIONS

### PV-1: MEDIUM — `manifest.ts:295-299` usa `process.cwd()` directamente
```typescript
const candidates = [
    path.resolve(thisDir, 'ui', 'lead-scoring.html'),
    path.resolve(process.cwd(), 'dist', 'modules', 'lead-scoring', 'ui', 'lead-scoring.html'),
    path.resolve(process.cwd(), 'src', 'modules', 'lead-scoring', 'ui', 'lead-scoring.html'),
]
```
CLAUDE.md dice: "Ningún módulo lee `process.env` directamente." `process.cwd()` no es `process.env`, pero sigue siendo acceso directo al runtime cuando el kernel debería proveer la ruta base. Esto no es grave pero es inconsistente si otros módulos obtienen rutas del registry.

### PV-2: LOW — SQL interval no parametrizado
**Archivo:** `src/modules/lead-scoring/pg-queries.ts:~407`
```typescript
conditions.push(`ac.updated_at >= NOW() - INTERVAL '${interval}'`)
```
El `interval` viene de un `intervalMap` hardcodeado (`'1 day'`, `'7 days'`, etc.) — no de input del usuario. No es SQL injection porque el valor es controlado. Pero el patrón es feo. Una función `$paramIdx++` con type cast sería más limpio, o usar `INTERVAL '1 day' * $N`.

---

## LO QUE ESTÁ BIEN (para ser honesto en ambas direcciones)

1. **Zero-LLM extraction** — Eliminar la llamada LLM redundante en `extract_qualification` es la decisión más valiosa de todo el branch. El ahorro de tokens y latencia por mensaje es significativo.
2. **Priority weights** — Reemplazar "pesos que suman 100" con high/medium/low es pragmáticamente correcto. El admin no debería hacer aritmética para configurar un scoring.
3. **Config migration** — Manejar 3 formatos de entrada (flat BANT, multi-framework, v3) con auto-migración y persistencia es robusto. El código es claro.
4. **Decay temporal** — La implementación es simple (linear decay con floor), fácil de entender, y la función `calculateDecay()` maneja edge cases (invalid date, negative window, NaN).
5. **Validation en ConfigStore** — Las validaciones son completas: max 10 criterios, keys únicos, stages referenciados, essentialQuestions válidas, enum con options. Bien.
6. **Transactional extraction** — El `SELECT FOR UPDATE` + merge + score + update en una transacción dentro de `handleExtraction()` es correcto y previene race conditions.
7. **Nightly batch sin LLM** — Eliminar la llamada LLM por cold lead es ahorro directo. El recalc por código es <1ms por lead vs ~2s por llamada LLM.

---

## RESUMEN EJECUTIVO

| Categoría | Crítico | Alto | Medio | Bajo |
|-----------|---------|------|-------|------|
| Bugs | 1 (XSS) | 2 | 3 | 0 |
| Gaps | 0 | 0 | 1 | 1 |
| Deuda | 0 | 1 | 2 | 1 |
| Complejidad | 0 | 0 | 2 | 0 |
| Redundancia | 0 | 0 | 0 | 2 |
| Policy | 0 | 0 | 1 | 1 |

**Recomendación:** Mergear después de arreglar BUG-1 (XSS), BUG-2 (confidence tracking), BUG-3 (tool re-registration), y BUG-4 (enum scoring 50% para valores inválidos). El resto es deuda aceptable para primera iteración.

**Prioridad de fixes:**
1. BUG-1: XSS en onclick — fix en 5 min
2. BUG-2: Confidence tracking — fix en 10 min
3. BUG-3: Tool re-registration — fix en 5 min
4. BUG-4: Enum scoring inflado — fix en 2 min
5. BUG-5: OFFSET pagination en nightly — fix en 10 min
