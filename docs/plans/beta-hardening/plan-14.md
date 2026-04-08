# Plan 14 — Google Apps Audit Fixes

**Prioridad:** HIGH (bloquea merge de la rama google-apps-improvements)
**Branch auditado:** `claude/plan-google-apps-improvements-0dfMU`
**Fuente:** `docs/reports/AUDIT-google-apps-branch.md`
**Objetivo:** Corregir todos los bugs, huecos funcionales y violaciones de politica encontrados en la auditoria. La rama NO debe mergearse sin estos fixes.

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/modules/google-apps/tools.ts` | BUG-3 regex, HUECO-1 validacion, COMPLEX-2 formatted |
| `src/modules/google-apps/sheets-service.ts` | BUG-4 wrapper faltante |
| `src/modules/google-apps/docs-service.ts` | BUG-2 applied count |
| `src/modules/google-apps/slides-service.ts` | BUG-6 batch atomico, DUP-1 getSlideText |
| `src/modules/google-apps/api-wrapper.ts` | BUG-1 timeout decorativo |
| `src/modules/google-apps/manifest.ts` | POL-1 activateByDefault |
| `src/modules/google-apps/types.ts` | HUECO-2 text opcional |
| `src/modules/google-apps/CLAUDE.md` | POL-1 correccion doc |
| `src/modules/google-apps/.env.example` | POL-2 archivo faltante |

## Paso 0 — Verificacion obligatoria

1. Hacer checkout de la rama `claude/plan-google-apps-improvements-0dfMU`
2. Leer TODOS los archivos target completos
3. Confirmar que cada bug existe en la ubicacion indicada
4. Verificar la firma de `googleApiCall` en `api-wrapper.ts` para entender el patron de AbortSignal

---

## FIX-01: BUG-1 — Timeout decorativo en `googleApiCall` [CRITICO]
**Archivo:** `src/modules/google-apps/api-wrapper.ts`
**Bug:** `googleApiCall` crea un `AbortController` con timeout pero el `signal` nunca se pasa a las requests HTTP de googleapis. Todos los callers ignoran el parametro signal de la lambda.
**Impacto:** Todas las llamadas a Google API carecen de timeout real. Una API lenta bloquea el thread indefinidamente.

**Investigacion requerida:**
1. Leer la firma actual de `googleApiCall` — verificar si recibe `fn: (signal: AbortSignal) => Promise<T>` o `fn: () => Promise<T>`
2. Verificar si las APIs de googleapis (`google.sheets`, `google.docs`, `google.slides`) aceptan `signal` o `AbortSignal` como opcion
3. Buscar en node_modules (si disponible) o en la documentacion de googleapis si soportan cancelacion

**Fix — Opcion A (si googleapis soporta signal):**
- Actualizar todos los callers para pasar signal: `(signal) => this.docs.documents.get({...}, { signal })`
- Esto requiere actualizar ~15 call sites en sheets-service, docs-service, slides-service

**Fix — Opcion B (si googleapis NO soporta signal — mas probable):**
- Implementar timeout via `Promise.race` en el wrapper:
```typescript
async function googleApiCall<T>(
  fn: () => Promise<T>,  // quitar signal del parametro
  config: ApiConfig,
  label: string,
): Promise<T> {
  const timeoutMs = config.timeoutMs ?? 30_000
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Google API timeout: ${label} after ${timeoutMs}ms`)), timeoutMs)
    timer.unref()  // no bloquear shutdown
  })
  
  // ... retry logic existente, pero envolver cada intento:
  const result = await Promise.race([fn(), timeoutPromise])
  return result
}
```
- Eliminar AbortController si ya no se usa
- Asegurar que el timeout aplica POR INTENTO, no globalmente (si hay retries)

**Nota:** Este bug es preexistente pero la rama lo propago a mas servicios. El fix debe aplicar a TODOS los callers.

---

## FIX-02: BUG-3 — Regex de paginacion matchea digitos en nombre de tab [ALTO]
**Archivo:** `src/modules/google-apps/tools.ts` ~linea 420
**Bug:** `/\d/.test(range)` matchea digitos en nombres como `Sheet1`, `Datos 2024`
**Impacto:** Paginacion server-side desactivada para casi todas las hojas.

**Fix:**
```typescript
// Antes:
const hasExplicitRows = /\d/.test(range)

// Despues:
const hasExplicitRows = /![A-Z]+\d/.test(range)
```

Esto solo matchea cuando hay un `!` seguido de letras de columna y digitos de fila (ej: `!A1`, `!B10`), que es el patron real de un rango con filas explicitas en Sheets.

---

## FIX-03: BUG-2 — `docs-service.batchEdit` retorna count incorrecto [ALTO]
**Archivo:** `src/modules/google-apps/docs-service.ts` ~linea 222
**Bug:** `return { applied: operations.length }` retorna total enviado, no aplicado realmente.

**Fix:**
1. Leer como lo hace `slides-service.ts` (~linea 208) para consistencia
2. Google Docs batchUpdate retorna `replies[]` — un reply por request
3. Para `replaceAllText`, el reply tiene `replaceAllText.occurrencesChanged`
4. Actualizar para retornar detalle:
```typescript
// Ejecutar batch
const res = await googleApiCall(
  () => this.docs.documents.batchUpdate({ documentId, requestBody: { requests } }),
  this.apiConfig, 'docs.documents.batchUpdate',
)

// Contar reales
const replies = res.data?.replies ?? []
const results = operations.map((op, i) => {
  const reply = replies[i]
  if (op.type === 'replace_text') {
    const changed = reply?.replaceAllText?.occurrencesChanged ?? 0
    return { type: op.type, detail: { occurrencesChanged: changed } }
  }
  return { type: op.type, detail: { applied: true } }
})

const applied = results.filter(r => {
  if (r.type === 'replace_text') return (r.detail as { occurrencesChanged: number }).occurrencesChanged > 0
  return true
}).length

return { applied, results }
```
5. Tambien aplicar a la rama de `insert_text`/`append_text` si tiene batch update separado

---

## FIX-04: BUG-4 — 4 metodos de Sheets sin `googleApiCall` wrapper [MEDIO]
**Archivo:** `src/modules/google-apps/sheets-service.ts` ~lineas 53-130
**Bug:** `writeRange`, `clearRange`, `createSpreadsheet`, `addSheet` llaman Google API directo sin retry ni timeout.

**Fix:** Envolver cada uno con `googleApiCall`:

```typescript
// writeRange (~linea 59)
const res = await googleApiCall(
  () => this.sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption: inputOption,
    requestBody: { values },
  }),
  this.apiConfig, 'sheets.values.update',
)

// clearRange (~linea 93)
await googleApiCall(
  () => this.sheets.spreadsheets.values.clear({
    spreadsheetId, range, requestBody: {},
  }),
  this.apiConfig, 'sheets.values.clear',
)

// createSpreadsheet (~linea 101)
const res = await googleApiCall(
  () => this.sheets.spreadsheets.create({
    requestBody: { properties: { title } },
    fields: 'spreadsheetId,properties.title,sheets.properties',
  }),
  this.apiConfig, 'sheets.spreadsheets.create',
)

// addSheet (~linea 121)
const res = await googleApiCall(
  () => this.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  }),
  this.apiConfig, 'sheets.spreadsheets.batchUpdate(addSheet)',
)
```

---

## FIX-05: BUG-6 — Slides batchEdit: deleteText falla y cancela todo el batch [MEDIO]
**Archivo:** `src/modules/google-apps/slides-service.ts` ~lineas 190-195
**Bug:** `deleteText` y `insertText` para `update_notes` van en el mismo array de requests. Si `deleteText` falla (ej: text box vacio sin texto), toda la batch falla.

**Fix:**
1. Separar `update_notes` en request independiente ANTES del batch principal:
```typescript
// Pre-process: ejecutar update_notes como operaciones independientes
const notesOps = operations.filter(op => op.type === 'update_notes')
const otherOps = operations.filter(op => op.type !== 'update_notes')

// Procesar notas una a una (aisladas del batch principal)
for (const op of notesOps) {
  try {
    const noteRequests = []
    // ... misma logica de deleteText/insertText
    if (noteRequests.length > 0) {
      await googleApiCall(
        () => this.slides.presentations.batchUpdate({
          presentationId, requestBody: { requests: noteRequests },
        }),
        this.apiConfig, 'slides.batchUpdate(notes)',
      )
    }
    results.push({ type: 'update_notes', detail: { slideIndex: op.slideIndex, updated: true } })
  } catch (err) {
    results.push({ type: 'update_notes', detail: { error: String(err) } })
  }
}

// Luego procesar replace_text y add_slide en batch normal
```
2. Alternativa mas simple: envolver el `deleteText` en try/catch individual y no fallar si no habia texto que borrar (el `existingText` check ya intenta esto pero puede fallar por timing)

---

## FIX-06: POL-1 — `activateByDefault: true` [ALTO — trivial]
**Archivo:** `src/modules/google-apps/manifest.ts` linea 383
**Bug:** Modulos tipo `provider` con dependencia OAuth no deben activarse por defecto.

**Fix:**
1. Cambiar `activateByDefault: true` → `activateByDefault: false`
2. En `CLAUDE.md` del modulo, si dice que se activa por defecto, corregir tambien

---

## FIX-07: POL-2 — Crear `.env.example` [MEDIO — trivial]
**Archivo:** `src/modules/google-apps/.env.example` — NO EXISTE

**Fix:** Crear archivo con las 7 variables del configSchema:
```bash
# Google Apps — Provider OAuth2 + API services
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/console/api/google-apps/oauth/callback
GOOGLE_ENABLED_SERVICES=drive,sheets,docs,slides,calendar
GOOGLE_PERMS_DRIVE=view,share,create,edit
GOOGLE_PERMS_SHEETS=view,share,create,edit
GOOGLE_PERMS_DOCS=view,share,create,edit
```
Verificar las 7 variables contra el configSchema real y ajustar.

---

## FIX-08: HUECO-1 — Validacion runtime de operaciones batch [MEDIO]
**Archivos:** `src/modules/google-apps/tools.ts` lineas 622, 775, 972
**Bug:** Cast directo `input.operations as XxxOperation[]` sin validacion.

**Fix:** Agregar validacion minima antes del cast en cada handler:
```typescript
// Sheets batch-edit handler (~linea 622)
const ops = input.operations as SheetBatchOperation[]
if (!Array.isArray(ops) || ops.length === 0) {
  return { success: false, error: 'operations must be a non-empty array' }
}
for (const op of ops) {
  if (!op.type || !['set_values', 'append_rows', 'clear', 'find_replace'].includes(op.type)) {
    return { success: false, error: `Invalid operation type: ${op.type}. Valid: set_values, append_rows, clear, find_replace` }
  }
}

// Mismo patron para Docs (~linea 775) y Slides (~linea 972) con sus tipos respectivos
```

Tambien actualizar los tool schemas para definir propiedades de `items` en vez de `{ type: 'object' }` vacio — esto ayuda al LLM a generar operaciones correctas.

---

## FIX-09: HUECO-2 — `SlideEditOperation.text` opcional pero requerido [BAJO]
**Archivo:** `src/modules/google-apps/types.ts` ~linea 151
**Bug:** `text?: string` es opcional pero `update_notes` e `insertText` lo requieren.

**Fix:** Agregar guard en slides-service.ts antes de usar `op.text`:
```typescript
if (op.type === 'update_notes') {
  if (!op.text && op.text !== '') {
    results.push({ type: 'update_notes', detail: { error: 'text is required for update_notes' } })
    continue
  }
  // ... resto de la logica
}
```

---

## FIX-10: HUECO-3 + DEUDA-3 — Unificar respuesta de batch edits [BAJO]
**Archivos:** `docs-service.ts`, `slides-service.ts`, `sheets-service.ts`
**Bug:** Los 3 servicios retornan contratos diferentes para batch edit.

**Fix:** Ya cubierto parcialmente por FIX-03 (docs retornara `results[]`). Verificar que los 3 sigan el mismo patron:
```typescript
{ applied: number, results: Array<{ type: string, detail: Record<string, unknown> }> }
```

---

## FIX-11: DUP-1 — Eliminar `getSlideText` si no tiene callers [BAJO — trivial]
**Archivo:** `src/modules/google-apps/slides-service.ts` ~lineas 54-57
**Bug:** `getSlideText` es wrapper trivial de `getSlideTextWithInfo`. Si no hay callers externos, es codigo muerto.

**Fix:**
1. Buscar `getSlideText` en todo el codebase (excluyendo su definicion)
2. Si NO hay callers → eliminar el metodo
3. Si hay callers → dejar como esta (backward compat)

---

## Verificacion post-fix

1. `sheets-read` con tab `Sheet1` → `hasExplicitRows = false` (paginacion server-side activa)
2. `sheets-read` con range `Sheet1!A1:D10` → `hasExplicitRows = true`
3. `docs-batch-edit` con replace que no matchea → `applied: 0`, no `applied: N`
4. `writeRange`, `clearRange`, `createSpreadsheet`, `addSheet` → retry en 429
5. `slides-batch-edit` con update_notes fallido → no cancela replace_text del batch
6. `googleApiCall` con API lenta (>30s) → timeout real, no cuelga
7. Manifest tiene `activateByDefault: false`
8. `.env.example` existe con las variables del configSchema
9. `slides-batch-edit` con `{ type: 'update_notes' }` sin text → error descriptivo
10. Compilar: `npx tsc --noEmit` — 0 errores nuevos

## Estrategia de ejecucion

**Todo en un solo agente, un solo branch derivado de `claude/plan-google-apps-improvements-0dfMU`.**

Orden recomendado:
1. FIX-06, FIX-07 (triviales — POL-1, POL-2)
2. FIX-02 (trivial — regex)
3. FIX-04 (bajo riesgo — wrapper)
4. FIX-08, FIX-09 (validacion)
5. FIX-03, FIX-10 (docs results — requiere entender replies de API)
6. FIX-05 (slides batch — reestructuracion)
7. FIX-01 (timeout — requiere investigacion)
8. FIX-11 (cleanup)

**BUG-5 (race condition en appendWithValidations):** Diferido — aceptable como best-effort documentado. Baja probabilidad en uso normal.
**DEUDA-1 (eslint-disable):** Diferido — justificado por googleapis types.
**DEUDA-2 (error handling inconsistente):** Diferido — unificar en siguiente refactor.
**COMPLEX-1 (paginacion sobre-engineered):** Diferido — simplificar despues de validar BUG-3 fix.
**COMPLEX-2 (formatted output):** Diferido — evaluar si el LLM se beneficia del formato tabular.
