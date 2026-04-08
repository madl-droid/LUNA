# AUDITORÍA — Rama `claude/plan-google-apps-improvements-0dfMU`

**Fecha:** 2026-04-08
**Planes auditados:** 01 (Sheets), 02 (Docs+Auth), 03 (Slides)
**Archivos modificados:** 7 archivos, +851 / -35 líneas
**Compilación TS:** Sin errores nuevos (errores preexistentes de entorno)

---

## Resumen ejecutivo

Los 3 planes se ejecutaron completos (17 tareas de 17). El código funciona y sigue las convenciones generales del proyecto. Sin embargo, hay **3 bugs reales**, **4 huecos funcionales**, **3 problemas de performance**, y varias oportunidades de simplificación.

**Severidad global: MEDIA** — no hay nada bloqueante para producción, pero hay issues que vale la pena corregir antes de mergear.

---

## BUGS (3)

### BUG-1: `docs-batch-edit` replace sin searchText hace no-op silencioso
**Archivo:** `docs-service.ts:178`
**Severidad:** Media

Para operaciones `type='replace'`, si `searchText` no se provee, el fallback es:
```typescript
containsText: { text: op.searchText ?? op.text, matchCase: true },
replaceText: op.text,
```
Esto busca `op.text` y lo reemplaza por `op.text` — un no-op silencioso. Debería validar que `searchText` esté presente para operaciones replace, o lanzar error claro.

**Fix:** Agregar guard al inicio de `batchEdit`:
```typescript
const invalidReplace = replaceOps.find(op => !op.searchText)
if (invalidReplace) throw new Error('Replace operations require searchText')
```

---

### BUG-2: `sheets-batch-edit` append NO restaura validaciones
**Archivo:** `sheets-service.ts:269-272` (batchEdit → append)
**Severidad:** Media

El tool `sheets-append` tiene lógica para capturar y restaurar validaciones de datos (dropdowns) post-append. Pero `sheets-batch-edit` con operaciones `type='append'` llama directamente a `this.appendRows()`, **sin la lógica de restauración**. Un usuario que use batch-edit para agregar filas perderá validaciones silenciosamente.

**Fix:** Extraer la lógica de validación a un método compartido, o delegar al handler del tool append.

---

### BUG-3: `slides-read` hace 2 llamadas API redundantes al presentation
**Archivo:** `tools.ts:862-863`
**Severidad:** Baja (performance, no funcional)

```typescript
const text = await slides.getSlideText(presentationId, slideIndex)  // → presentations.get()
const info = await slides.getPresentation(presentationId)            // → presentations.get() OTRA VEZ
```
Cada `slides-read` hace **dos GET** al mismo presentation. Desperdicia quota de API y duplica latencia.

**Fix:** Refactorizar `getSlideText` para aceptar data pre-fetched, o crear un método que retorne ambos en una sola llamada.

---

## HUECOS FUNCIONALES (4)

### HUECO-1: No hay console field para `GOOGLE_SHEETS_PROTECTED_IDS`
**Archivo:** `manifest.ts` — `console.fields`

La env var `GOOGLE_SHEETS_PROTECTED_IDS` se declaró en `configSchema` pero NO se agregó a `console.fields`. Los admins solo pueden configurarla editando `.env` manualmente. Esto contradice el objetivo de "admin-configurable" del plan.

**Fix:** Agregar a `console.fields`:
```typescript
{
  key: 'GOOGLE_SHEETS_PROTECTED_IDS',
  type: 'text',
  label: { es: 'Sheets protegidos (IDs)', en: 'Protected Sheets (IDs)' },
  info: { es: 'IDs de spreadsheets protegidos contra escritura, separados por coma', en: 'Comma-separated spreadsheet IDs protected from writes' },
}
```

---

### HUECO-2: No hay `.env.example` para el módulo
**Ubicación:** `src/modules/google-apps/.env.example` — NO EXISTE

El módulo tiene `configSchema` con múltiples env vars pero no tiene `.env.example`. Según las reglas del proyecto: "Config: agregar configSchema + .env.example". Esto es una deuda preexistente pero la rama debería haber agregado al menos `GOOGLE_SHEETS_PROTECTED_IDS` a un `.env.example`.

---

### HUECO-3: `updateSpeakerNotes` lanza excepciones en vez de errores tool-friendly
**Archivo:** `slides-service.ts:102-118`

El método lanza `throw new Error(...)` para condiciones esperadas:
- "Slide X no encontrado"
- "El slide no tiene página de notas"
- "No se encontró text box en la página de notas"

Estos son errores de input del usuario, no fallas de sistema. El tool handler no los atrapa, así que llegan como errores genéricos al pipeline. Debería retornar `{ success: false, error: '...' }` como hacen los otros tools.

**Fix:** Wrap en try/catch en el handler de `slides-update-notes`:
```typescript
handler: async (input) => {
  try {
    await slides.updateSpeakerNotes(...)
    return { success: true, data: { updated: true, slideIndex: input.slideIndex } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

---

### HUECO-4: `batchEdit` de Docs/Slides siempre reporta `applied: operations.length`
**Archivos:** `docs-service.ts:259`, `slides-service.ts:208`

Ambos batch-edit retornan `{ applied: operations.length }` independientemente de si las operaciones realmente se ejecutaron. En slides-batch-edit, las operaciones `update_notes` que fallan (slide no encontrado) se registran en `results` con error pero `applied` no descuenta. Esto da una falsa impresión de éxito.

**Fix:** Contar solo las operaciones que realmente se procesaron:
```typescript
return { applied: results.filter(r => !r.detail?.error).length, results }
```

---

## PROBLEMAS DE PERFORMANCE (3)

### PERF-1: `sheets-read` carga TODA la hoja en memoria para paginar
**Archivo:** `tools.ts:425`
**Impacto:** Alto en hojas grandes

La paginación se implementa client-side: lee todo el rango con `readRange()`, luego hace `slice()` en memoria. Para hojas con 100K+ filas, esto carga todo en RAM y puede causar OOM o timeouts.

**Mitigación:** Documentar el límite o, idealmente, usar la API de Sheets para limitar filas server-side con un rango calculado (ej: `Sheet1!A1:Z501` para limit=500).

---

### PERF-2: `isProtectedSheet()` re-parsea la config en cada invocación
**Archivo:** `tools.ts:387-391`

Cada llamada a un tool de escritura (write, append, find-replace, batch-edit) ejecuta:
```typescript
const config = registry.getConfig<GoogleApiConfig>('google-apps')
const ids = config.GOOGLE_SHEETS_PROTECTED_IDS.split(',').map(s => s.trim()).filter(Boolean)
return ids.includes(spreadsheetId)
```
Esto parsea el string y crea un array nuevo en cada invocación. Debería cachearse.

**Fix:** Parsear una vez al registrar los tools:
```typescript
const config = registry.getConfig<GoogleApiConfig>('google-apps')
const protectedIds = new Set(config.GOOGLE_SHEETS_PROTECTED_IDS.split(',').map(s => s.trim()).filter(Boolean))
function isProtectedSheet(id: string): boolean { return protectedIds.has(id) }
```

---

### PERF-3: `sheets-service.batchEdit` itera operations 4 veces con `.filter()`
**Archivo:** `sheets-service.ts:251-291`

```typescript
const writeOps = operations.filter(op => op.type === 'write' && ...)
const appendOps = operations.filter(op => op.type === 'append' && ...)
const clearOps = operations.filter(op => op.type === 'clear' && ...)
const frOps = operations.filter(op => op.type === 'find_replace' && ...)
```
4 iteraciones sobre el mismo array. Menor impacto, pero se puede hacer en una sola pasada.

---

## COMPLEJIDAD INNECESARIA (2)

### COMPLEX-1: `docs-service.batchEdit` tiene 3 ramas que comparten código
**Archivo:** `docs-service.ts:220-257`

Hay 3 bloques casi idénticos: `hasMixed`, `only replaces`, `only inserts/appends`. El bloque `only replaces` es un subconjunto de `hasMixed` (skip inserts). Se puede simplificar a 2 pasos secuenciales:
```typescript
if (replaceOps.length > 0) { /* execute replaces */ }
if (insertOps.length > 0 || appendOps.length > 0) { /* fetch endIndex, execute */ }
```
Sin necesidad del flag `hasMixed`.

---

### COMPLEX-2: Exceso de eslint-disable en slides-service.ts
**Archivo:** `slides-service.ts` — 15+ instancias de `// eslint-disable-next-line @typescript-eslint/no-explicit-any`

El uso masivo de `any` en slides-service.ts (especialmente en `updateSpeakerNotes` y `batchEdit`) indica que los types de la Google Slides API no están bien tipados. En lugar de suprimir eslint línea por línea, sería más limpio:
1. Definir un type local para la estructura de slide/notesPage
2. O usar un bloque `/* eslint-disable */` al inicio del método con un comentario explicando por qué

---

## REDUNDANCIAS / DUPLICACIÓN (3)

### DUP-1: `extractSlideText` y `extractSpeakerNotes` son casi idénticos
**Archivo:** `slides-service.ts:254-305`

Ambos métodos iteran `pageElements → shape → text → textElements → textRun → content`. La única diferencia es la fuente (slide.pageElements vs slide.slideProperties.notesPage.pageElements) y el filtrado de whitespace en notes.

**Fix:** Extraer un helper `extractTextFromElements(elements: Array<Record<string, unknown>>): string`.

---

### DUP-2: `updateSpeakerNotes` duplica lógica de `batchEdit` para notes
**Archivo:** `slides-service.ts:102-137` vs `slides-service.ts:170-197`

La lógica para encontrar el TEXT_BOX, detectar texto existente, y construir requests de delete+insert está duplicada entre `updateSpeakerNotes` (método standalone) y `batchEdit` (inline en el loop). Si se corrige un bug en uno, hay que recordar corregirlo en el otro.

**Fix:** Refactorizar `updateSpeakerNotes` para usar `batchEdit` internamente:
```typescript
async updateSpeakerNotes(presentationId: string, slideIndex: number, text: string): Promise<void> {
  await this.batchEdit(presentationId, [{ type: 'update_notes', slideIndex, text }])
}
```

---

### DUP-3: DocsService y SlidesService NO usan `googleApiCall` wrapper
**Archivos:** `docs-service.ts`, `slides-service.ts`

SheetsService usa `googleApiCall()` de `api-wrapper.ts` consistentemente para timeout + retry con backoff. DocsService y SlidesService hacen llamadas directas sin wrapper. Esto es una inconsistencia preexistente, pero el código nuevo (batchEdit para ambos) perpetúa la deuda.

**Impacto:** Docs y Slides no tienen timeout ni retry en rate-limiting (429) o server errors (5xx).

---

## VIOLACIONES DE POLÍTICAS (1)

### POL-1: CLAUDE.md dice `activateByDefault: false` pero manifest dice `true`
**Archivo:** `CLAUDE.md` línea "type: provider, removable: true, activateByDefault: false"
**Archivo:** `manifest.ts:383` → `activateByDefault: true`

El CLAUDE.md documenta `activateByDefault: false` pero el manifest real tiene `true`. Esto es una inconsistencia de documentación, no de código.

---

## CHECKLIST DE CONFORMIDAD

| Regla | Estado | Notas |
|-------|--------|-------|
| No `process.env` | ✅ | Todo via registry.getConfig() |
| Imports con `.js` | ✅ | Todos los imports relativos con extensión |
| Helpers HTTP del kernel | ✅ | Usa jsonResponse, parseBody |
| Helpers config del kernel | ✅ | Usa numEnv |
| `noUncheckedIndexedAccess` | ✅ | Usa `!` con guard o `?.` |
| SQL raw sin ORM | ✅ | N/A (no SQL nuevo) |
| CLAUDE.md actualizado | ✅ | Refleja las nuevas tools |
| Sin imports entre módulos | ✅ | Solo types y kernel |

---

## RESUMEN POR PRIORIDAD

### Corregir antes de merge (P1)
1. **BUG-1**: Replace sin searchText → no-op silencioso
2. **BUG-2**: batch-edit append sin restaurar validaciones
3. **HUECO-3**: updateSpeakerNotes lanza excepciones sin catch en handler

### Corregir pronto (P2)
4. **HUECO-1**: Console field para GOOGLE_SHEETS_PROTECTED_IDS
5. **BUG-3**: slides-read doble fetch
6. **PERF-1**: sheets-read carga toda la hoja para paginar
7. **DUP-2**: updateSpeakerNotes duplica lógica de batchEdit
8. **HUECO-4**: applied count no refleja operaciones fallidas

### Deuda técnica (P3)
9. **PERF-2**: isProtectedSheet re-parsea config cada vez
10. **DUP-1**: extractSlideText/extractSpeakerNotes duplicados
11. **DUP-3**: Docs/Slides sin googleApiCall wrapper
12. **COMPLEX-1**: docs batchEdit simplificable
13. **COMPLEX-2**: eslint-disable spam en slides
14. **HUECO-2**: Falta .env.example
15. **POL-1**: CLAUDE.md activateByDefault inconsistente
