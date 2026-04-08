# AUDITORÍA — Branch `claude/plan-google-apps-improvements-0dfMU`

**Fecha:** 2026-04-08
**Auditor:** Claude (sesión audit)
**Scope:** 11 commits, 14 archivos, +3363/-148 líneas
**Base:** commit `5d5d35a` (branch `claude/project-planning-session-Zwy1r`)

---

## Resumen ejecutivo

La rama implementa mejoras a Sheets (6 items), Docs (3 items), Slides (4 items) y Auth (1 item) para el módulo `google-apps`. Incluye un ciclo de auto-auditoría (Plan 04) que corrigió varios problemas. **Sin embargo, persisten bugs significativos, huecos de tipo safety, inconsistencias y violaciones de política.**

**Veredicto:** La rama tiene buen trabajo funcional pero necesita correcciones antes de merge. Se encontraron **3 bugs críticos/altos, 6 bugs medios, 2 violaciones de política, y 3 items de deuda técnica.**

---

## BUGS

### BUG-1 (CRÍTICO): `googleApiCall` timeout no funciona — AbortSignal ignorado

**Archivos:** `api-wrapper.ts`, `docs-service.ts`, `sheets-service.ts`, `slides-service.ts`

El wrapper `googleApiCall` define:
```typescript
fn: (signal: AbortSignal) => Promise<T>
```
Pero **TODOS los callers pasan lambdas que ignoran el signal**:
```typescript
// Ejemplo: docs-service.ts:22
const res = await googleApiCall(
  () => this.docs.documents.get({...}),  // ← lambda ignora signal
  this.apiConfig, 'docs.documents.get',
)
```

El `AbortController.abort()` se ejecuta al timeout, pero como ningún caller pasa el signal a la request HTTP subyacente de `googleapis`, **el timeout es decorativo**. Las requests siguen colgadas indefinidamente.

**Impacto:** Todas las llamadas a Google API carecen de timeout real. Un API call lento bloquea el thread sin posibilidad de corte.

**Nota:** Esto NO es un bug introducido por esta rama — es preexistente en `api-wrapper.ts`. Sin embargo, esta rama extendió el uso de `googleApiCall` a Docs y Slides (DUP-3) propagando el bug a más servicios.

---

### BUG-2 (ALTO): `docs-service.batchEdit` retorna `applied: operations.length` siempre

**Archivo:** `docs-service.ts:222`

```typescript
return { applied: operations.length }
```

Retorna el **total de operaciones enviadas**, no las que realmente se aplicaron. Si un `replaceAllText` no encuentra el texto, no hace nada pero se cuenta como "aplicada". Esto contrasta con `slides-service.batchEdit` que filtra errores correctamente:

```typescript
// slides-service.ts:208
const successCount = results.filter(r => !(r.detail as Record<string, unknown>)?.error).length
return { applied: successCount, results }
```

**Impacto:** El agente recibe feedback incorrecto sobre cuántas operaciones realmente modificaron el documento. Podría reportar "5 operaciones aplicadas" cuando 0 textos fueron encontrados.

---

### BUG-3 (ALTO): Regex de paginación `sheets-read` falla con nombres de tab que contienen dígitos

**Archivo:** `tools.ts:420`

```typescript
const hasExplicitRows = /\d/.test(range)
```

Esta regex detecta si el rango tiene filas explícitas (ej: `A1:D10`), pero matchea cualquier dígito **incluyendo los del nombre del tab**.

- `'Sheet1'` (auto-detected, sin filas) → `hasExplicitRows = true` ← **INCORRECTO**
- `'Datos 2024'` → `hasExplicitRows = true` ← **INCORRECTO**
- `CustomSheet` → `hasExplicitRows = false` ← correcto por accidente

**Impacto:** Para cualquier tab cuyo nombre contiene un dígito (prácticamente todos), la optimización de paginación server-side se omite. Se carga la hoja completa en memoria.

**Fix sugerido:**
```typescript
const hasExplicitRows = /![A-Z]+\d/.test(range)  // Solo después del !
```

---

### BUG-4 (MEDIO): `writeRange`, `clearRange`, `createSpreadsheet`, `addSheet` no usan `googleApiCall`

**Archivo:** `sheets-service.ts:53-130`

Estos 4 métodos llaman a Google API directamente sin el wrapper `googleApiCall`:
- `writeRange()` (línea 59) → `this.sheets.spreadsheets.values.update({...})` directo
- `clearRange()` (línea 93) → `this.sheets.spreadsheets.values.clear({...})` directo
- `createSpreadsheet()` (línea 101) → `this.sheets.spreadsheets.create({...})` directo
- `addSheet()` (línea 121) → `this.sheets.spreadsheets.batchUpdate({...})` directo

Mientras que `readRange`, `appendRows`, `getSpreadsheet`, `findReplace`, `batchEdit` **sí** usan el wrapper.

**Impacto:** Sin retry en 429/5xx ni timeout para operaciones de escritura. Inconsistencia silenciosa.

---

### BUG-5 (MEDIO): `appendWithValidations` race condition en índices de fila

**Archivo:** `sheets-service.ts:205-240`

Secuencia:
1. Lee `lastDataRow` y captura validaciones
2. Ejecuta `appendRows`
3. Aplica validaciones a filas `lastDataRow + 1` a `lastDataRow + N`

Si otro writer hace append entre pasos 2 y 3, los índices de fila son incorrectos y las validaciones se aplican a las filas equivocadas.

Además, el paso 3 es fire-and-forget (`.catch(() => {})`), ocultando cualquier error.

**Impacto:** En uso concurrente, validaciones aplicadas a datos incorrectos. Baja probabilidad en uso normal pero posible.

---

### BUG-6 (MEDIO): `slides-service.batchEdit` — `deleteText` + `insertText` en batch atómico

**Archivo:** `slides-service.ts:167-206`

Para `update_notes`, el método pushea `deleteText` e `insertText` al mismo array de requests, enviados en una sola `batchUpdate`. Si `deleteText` falla (ej: text box ya vacío), **toda la batch falla** incluyendo los `insertText` y `replaceAllText` de otras operaciones.

**Impacto:** Un error en una operación de notas cancela TODAS las operaciones del batch, incluyendo replaces que habrían sido exitosos.

---

## HUECOS FUNCIONALES

### HUECO-1: Sin validación runtime de operaciones batch

**Archivos:** `tools.ts:622, 772, 970`

Los 3 tool handlers de batch-edit hacen cast directo:
```typescript
input.operations as SheetBatchOperation[]  // sin validación
input.operations as DocEditOperation[]     // sin validación
input.operations as SlideEditOperation[]   // sin validación
```

No hay validación Zod ni manual de la estructura. Un LLM podría enviar `{ type: "invalid" }` y el cast pasa. Los schemas de los tools definen `items: { type: 'object' }` sin propiedades — esqueleto vacío.

**Impacto:** Errores crípticos de Google API en lugar de mensajes claros de validación. El agente no puede autocorregir.

---

### HUECO-2: `SlideEditOperation.text` es opcional pero requerido para `update_notes`

**Archivo:** `types.ts:151-162`

```typescript
export interface SlideEditOperation {
  type: 'replace_text' | 'add_slide' | 'update_notes'
  text?: string  // ← opcional
}
```

Si el LLM envía `{ type: 'update_notes', slideIndex: 1 }` sin `text`, el `insertText` de la API recibe `undefined` como texto.

**Fix:** Usar discriminated union o validar en runtime.

---

### HUECO-3: `docs-batch-edit` no retorna detalle de resultados por operación

A diferencia de `sheets-batch-edit` (retorna `results[]` con detalle por tipo) y `slides-batch-edit` (retorna `results[]` con detalle + errores), `docs-batch-edit` solo retorna `{ applied: N }` — sin breakdown.

**Impacto:** El agente no puede saber cuáles operaciones de un batch tuvieron efecto.

---

## VIOLACIONES DE POLÍTICA

### POL-1: `activateByDefault: true` en manifest

**Archivo:** `manifest.ts:383`

```typescript
activateByDefault: true,
```

La tabla de módulos en `docs/architecture/module-system.md` dice:
> google-apps | provider | — | **inactivo**

Los módulos tipo `provider` con dependencia externa (OAuth2) **no deben** activarse por defecto. Requieren configuración manual.

**CLAUDE.md también fue actualizado incorrectamente** para reflejar `activateByDefault: true` (CLAUDE.md línea 5).

---

### POL-2: Falta `.env.example`

**Archivo:** `src/modules/google-apps/.env.example` — NO EXISTE

La regla en `src/modules/CLAUDE.md` dice: módulos con `configSchema` deben tener `.env.example` documentando sus variables. El módulo declara 7 variables en su configSchema pero no tiene archivo de ejemplo.

---

## DEUDA TÉCNICA

### DEUDA-1: 11 `eslint-disable @typescript-eslint/no-explicit-any` en slides-service.ts

La auto-auditoría los identificó (COMPLEX-2) y los difirió. Son necesarios por la tipificación débil de googleapis, pero podrían reducirse con interfaces wrapper.

---

### DEUDA-2: Inconsistencia en error handling de tool handlers

Algunos handlers usan try/catch y retornan `{ success: false, error }`:
- `slides-update-notes` (tools.ts:935-946) — catch explícito

Otros dejan que las excepciones propaguen:
- `sheets-read`, `docs-read`, `sheets-batch-edit`, `docs-batch-edit` — sin catch

No hay patrón unificado. Si el pipeline de tools espera `{ success: false }`, los handlers que propagan excepciones causan comportamiento diferente al del LLM.

---

### DEUDA-3: `batchEdit` response types inconsistentes

| Servicio | Retorno |
|----------|---------|
| **Sheets** | `{ results: Array<{ type, detail }> }` |
| **Docs** | `{ applied: number }` |
| **Slides** | `{ applied: number, results: Array<{ type, detail }> }` |

Tres servicios homólogos con tres contratos de retorno diferentes. El agente necesita lógica diferente para interpretar cada uno.

---

## COMPLEJIDAD INNECESARIA

### COMPLEX-1: Paginación híbrida en `sheets-read` sobre-engineered

**Archivo:** `tools.ts:395-473`

La lógica de paginación tiene 3 paths:
1. Range sin dígitos → limita server-side con `!A1:ZZZ{maxRow}`
2. Range con dígitos (BUG-3) → lee todo y pagina client-side
3. Detección de `mayHaveMore` cuando el server-side _podría_ tener más datos

El resultado incluye `hasMore`, `nextOffset`, `mayHaveMore` — dos señales para "hay más datos" que confunden:
```typescript
hasMore: hasMore || mayHaveMore,                    // combinadas
nextOffset: nextOffset ?? (mayHaveMore ? offset + limit : null),  // fallback
```

**Simplificación:** Siempre hacer server-side range limitado (quitar path client-side). Eliminar `mayHaveMore` como concepto separado.

---

### COMPLEX-2: Output formateado "tabular" en `sheets-read`

**Archivo:** `tools.ts:448-460`

Se construye una tabla con `────` y `─┼─` como separadores para el output al LLM. Esto consume tokens extra y no agrega valor — el LLM interpreta JSON igual de bien. El campo `formatted` coexiste con los datos estructurados (`header`, `totalRows`, etc.), duplicando la información.

---

## REDUNDANCIAS

### DUP-1: `getSlideText` es wrapper trivial de `getSlideTextWithInfo`

**Archivo:** `slides-service.ts:54-57`

```typescript
async getSlideText(...): Promise<string> {
  const result = await this.getSlideTextWithInfo(...)
  return result.text
}
```

`getSlideText` solo existe por backward compatibility con callers externos. Pero dado que `tools.ts` ya migró a `getSlideTextWithInfo`, no hay callers internos de `getSlideText`. Si no hay consumidores externos del servicio, es código muerto.

---

## COSAS BIEN HECHAS ✅

1. **`googleApiCall` en Docs y Slides** — DUP-3 del audit se resolvió correctamente, extendiendo retry/timeout a todos los servicios (aunque el timeout es decorativo, ver BUG-1)
2. **`updateSpeakerNotes` delega a `batchEdit`** — DUP-2 resuelto, evitando duplicación
3. **`extractTextFromElements` compartido** — DUP-1 resuelto, una sola función para extraer texto de shapes y speaker notes
4. **Validación de `searchText` en docs batchEdit** — BUG-1 del audit resuelto con guard explícito
5. **OAuth retry con backoff** — A1 implementado con 3 intentos y exponential backoff (2s, 4s)
6. **Speaker notes en slides-read** — SL1 bien implementado con output claro `[Notas del presentador]: ...`
7. **appendWithValidations como método reutilizable** — S3 bien diseñado, compartido entre append tool y batch-edit
8. **Tipos bien definidos** — `SheetBatchOperation`, `DocEditOperation`, `SlideEditOperation` son claros y extensibles
9. **Eliminación de S2 (Protected Sheets)** — Decisión correcta, Drive permissions ya cubren protección
10. **El auto-audit cycle (Plan 04)** — Muestra rigor. Identificó y corrigió varios issues reales

---

## MATRIZ DE PRIORIDAD

| ID | Severidad | Esfuerzo | Acción |
|----|-----------|----------|--------|
| BUG-1 (timeout) | CRÍTICO | Alto | Investigar si googleapis soporta AbortSignal. Si no, implementar timeout via Promise.race. Preexistente pero propagado. |
| BUG-2 (applied count) | ALTO | Bajo | Retornar `results[]` como Sheets/Slides, o contar reales de replies |
| BUG-3 (regex) | ALTO | Bajo | Cambiar regex a `/![A-Z]+\d/` |
| BUG-4 (wrapper faltante) | MEDIO | Bajo | Envolver 4 métodos con googleApiCall |
| BUG-5 (race condition) | MEDIO | Medio | Aceptable como best-effort documentado |
| BUG-6 (batch atómico) | MEDIO | Medio | Separar deleteText en request independiente |
| HUECO-1 (validación) | MEDIO | Medio | Agregar Zod schemas a handlers batch |
| HUECO-2 (text opcional) | BAJO | Bajo | Agregar guard `if (!op.text) throw` |
| HUECO-3 (docs results) | BAJO | Bajo | Retornar `results[]` como los demás |
| POL-1 (activateByDefault) | ALTO | Trivial | Cambiar a `false` en manifest + CLAUDE.md |
| POL-2 (.env.example) | MEDIO | Trivial | Crear archivo |
| DEUDA-1 (eslint) | BAJO | Medio | Diferir — justificado por googleapis types |
| DEUDA-2 (error handling) | BAJO | Medio | Unificar patrón en siguiente refactor |
| DEUDA-3 (response types) | BAJO | Bajo | Unificar contrato de batch edit |
| COMPLEX-1 (paginación) | BAJO | Medio | Simplificar en siguiente iteración |
| COMPLEX-2 (formatted) | BAJO | Trivial | Considerar eliminar `formatted` |
| DUP-1 (getSlideText) | BAJO | Trivial | Eliminar si no hay callers |

**Fixes inmediatos requeridos antes de merge:** BUG-2, BUG-3, BUG-4, POL-1, POL-2
**Fixes deseables:** HUECO-1, HUECO-2, HUECO-3, BUG-6
**Diferibles:** BUG-1 (preexistente), BUG-5 (best-effort aceptable), DEUDA-*, COMPLEX-*, DUP-1
