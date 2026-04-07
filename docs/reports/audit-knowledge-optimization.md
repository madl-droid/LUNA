# AUDITORÍA — Knowledge Optimization (Branch: claude/project-planning-session-nrsYJ)

> **Auditor**: Claude Opus 4.6 (sesión audit-project-planning-O9F9V)
> **Fecha**: 2026-04-07
> **Commits auditados**: `4d5ceb8` (Plan 1), `49a3230` (Plan 2), `8b50441` (Plan 3)
> **Scope**: 17 archivos modificados, ~688 líneas agregadas

---

## Resumen ejecutivo

La implementación cumple ~80% de lo planificado. El código compila sin errores semánticos. Sin embargo, hay **5 bugs** (2 de severidad alta), **4 features incompletas**, **redundancia significativa de copy-paste** (4x), y **código muerto** que nunca se conectó. No se encontraron violaciones de políticas del CLAUDE.md.

---

## BUGS (6)

### BUG-1: `invalidateExpandCache()` nunca se llama — cache stale [MEDIO]
**Archivo**: `src/modules/knowledge/knowledge-manager.ts:479`

El método `invalidateExpandCache(documentId)` existe pero **no tiene ningún caller** en todo el codebase. Cuando un documento se re-entrena, `expand_knowledge` seguirá sirviendo el contenido viejo del cache Redis por hasta 15 minutos.

**Fix**: Llamar `invalidateExpandCache(docId)` en `loadContent()` o `persistSmartChunks()` después de actualizar los chunks.

---

### BUG-2: `console.log` de debug en código de producción [BAJO]
**Archivo**: `src/modules/knowledge/console-section.ts:813-814`

Dos `console.log('CREATE response:', ...)` quedan en el client-side JS del wizard. Se emiten al browser console de cada usuario.

**Fix**: Eliminar las líneas.

---

### BUG-3: `verify-url` retorna `accessible: true` para input no-URL [BAJO]
**Archivo**: `src/modules/knowledge/manifest.ts:980-983`

El branch `if (!extracted)` retorna `{ accessible: true, sourceType: 'web' }`. Pero `extractGoogleId()` solo retorna `null` si el input no es una URL válida. Esto es una regresión — antes devolvía 400.

**Fix**: Retornar `{ accessible: false }` cuando `!extracted` y no es URL parseable.

---

### BUG-4: Missing `await` en handler de `expand_knowledge` — try/catch es dead code [ALTO]
**Archivo**: `src/modules/knowledge/manifest.ts:1396`

El handler retorna `knowledgeManager!.expandKnowledge(documentId)` sin `await`. Como `expandKnowledge` es async, el `try/catch` que lo envuelve **nunca captura errores** — la Promise se retorna directamente y cualquier error se propaga como rechazo no manejado.

**Fix**: Agregar `await` → `return await knowledgeManager!.expandKnowledge(documentId)`

---

### BUG-5: Index chunks se duplican en cada re-sync — `contentHash` usa `Date.now()` [ALTO]
**Archivo**: `src/modules/knowledge/item-manager.ts:539`

`createHash('sha256').update(\`index:${item.id}:${Date.now()}\`)` genera un hash diferente cada vez que se llama `loadContent()`. Si un item se re-sincroniza, se crea un nuevo documento índice **sin eliminar el anterior**. Sobre múltiples syncs, se acumulan documentos índice orphaned en la base de datos, contaminando resultados de búsqueda.

**Fix**: Usar hash determinístico `index:${item.id}` sin `Date.now()`, o eliminar el index doc anterior antes de crear uno nuevo.

---

### BUG-6: Index chunks hardcodean `sourceType: 'drive'` independiente del tipo real [MEDIO]
**Archivo**: `src/modules/knowledge/item-manager.ts:545`

Los documentos índice siempre se crean con `sourceType: 'drive'`. Un item de Sheets o YouTube tendrá su index doc marcado como `drive`. Esto es misleading en resultados de búsqueda y en los badges de `sourceType`.

**Fix**: Pasar `item.sourceType` real al crear el index document.

---

## GAPS — Features del plan no implementadas (4)

### GAP-1: `llmDescription` nunca se propaga a chunkers [MEDIO]
**Archivos**: `src/modules/knowledge/extractors/smart-chunker.ts`, `src/modules/knowledge/item-manager.ts`

Plan 1, Tarea 4 pedía propagar descripciones LLM a los chunkers. El parámetro `llmDescription` fue agregado a la firma de `chunkDocs()` y otros chunkers, pero **ningún caller lo pasa**. Es plumbing muerto — la opción existe pero jamás se usa.

---

### GAP-2: `liveQueryInfo` en resultados de search_knowledge no implementado [BAJO]
**Archivo**: `src/modules/knowledge/types.ts`

Plan 2, Tarea 4 especificaba agregar `liveQueryInfo` (ej: `"sheets-read:SPREADSHEET_ID"`) a los resultados de búsqueda para que el agente sepa si puede consultar en vivo. El campo no existe en el tipo `KnowledgeSearchResult` ni en la respuesta del tool. Solo existe en `expand_knowledge` como `liveQueryHint`.

---

### GAP-3: Index chunks para knowledge multi-documento no implementados [MEDIO]
**Plan 2, Tarea 2** pedía crear chunks índice para items con múltiples tabs/documentos. Revisando `item-manager.ts`, la función `buildIndexChunk()` **existe** y se llama después de `loadContent()` para items multi-documento. Sin embargo, falta validar que el chunk índice se persiste correctamente y participa en búsqueda.

**Nota**: Necesita verificación en runtime. Si `buildIndexChunk()` funciona, esta gap no aplica.

---

### GAP-4: Web images perdidas en la adaptación del extractor [BAJO]
**Archivo**: `src/modules/knowledge/item-manager.ts`

Al migrar de `extractWebBlocks()` propio a `extractWeb()` global, las imágenes detectadas en la web se pierden. El adapter siempre pone `images: []` al convertir secciones a `WebBlock`. El alt-text se preserva dentro del texto del contenido, pero la metadata explícita de imágenes se descarta.

---

## REDUNDANCIA Y DUPLICACIÓN (2)

### REDUNDANCY-1: Reconstrucción de page texts copiada 4 veces [MEDIO]
**Archivo**: `src/modules/knowledge/item-manager.ts`

El patrón idéntico de "crear `pageTextsMap` → iterar sections → build `pageTexts` array" aparece verbatim en:
1. `loadSlidesContent()` (~líneas 668-678)
2. `loadPdfContent()` (~líneas 1171-1182)
3. `persistVisualPdf()` (~líneas 1228-1238)
4. `persistVisualSlides()` (~líneas 1280-1289)

**Fix**: Extraer a un helper privado `reconstructPageTexts(pdfResult)`.

---

### REDUNDANCY-2: Patrón enrichWithLLM copiado 4 veces [MEDIO]
**Archivo**: `src/modules/knowledge/item-manager.ts`

Las mismas 3 líneas (dynamic import + enrichWithLLM call + visualDescriptions extraction) se repiten en los mismos 4 métodos.

```typescript
const { enrichWithLLM } = await import('../../extractors/index.js')
const enriched = await enrichWithLLM({ ...pdfResult, kind: 'document' as const }, this.registry)
const visualDescriptions = enriched.kind === 'document' ? enriched.llmEnrichment?.visualDescriptions : undefined
```

**Fix**: Método privado `enrichPdfWithLLM(pdfResult)`.

---

## COMPLEJIDAD INNECESARIA (3)

### COMPLEXITY-1: `enrichWithLLM()` para documents no llama a ningún LLM [BAJO]
**Archivo**: `src/extractors/index.ts:273-299`

El case `'document'` en `enrichWithLLM()` NO hace llamada a LLM. Solo reorganiza secciones existentes de `extractPDF` que ya contienen descripciones visuales. El nombre `enrichWithLLM` es misleading — es una reorganización de data, no enriquecimiento LLM. El wrapper agrega `provider: 'pdf-vision'`, `generatedAt: new Date()` sin que haya un provider real.

---

### COMPLEXITY-2: Guard `enriched.kind === 'document'` siempre es true [BAJO]
**Archivo**: `src/modules/knowledge/item-manager.ts` (4 lugares)

Los 4 call sites crean el resultado con `kind: 'document' as const` y luego verifican `enriched.kind === 'document'`. Esta condición nunca puede ser false. Es código defensivo innecesario.

---

### COMPLEXITY-3: `skipScannerFallback` es dead weight [BAJO]
**Archivo**: `src/modules/knowledge/console-section.ts:752-758`

La lógica vieja de detección por URL substring (`lUrl.indexOf('.pdf')`, etc.) se preserva como fallback, pero el servidor ahora siempre retorna `sourceType` en verify-url. El fallback es unreachable.

**Fix**: Eliminar `skipScannerFallback` y la lógica de URL sniffing.

---

## DEUDA TÉCNICA (3)

### DEBT-1: Brittle section title matching para contenido visual
**Archivo**: `src/extractors/index.ts:279-281`

El filtro `s.title?.includes('(visual)') || s.title?.includes('OCR')` depende de strings hardcodeados que genera `extractPDF` internamente. Si `extractPDF` cambia el formato de títulos, `enrichWithLLM` silenciosamente deja de detectar contenido visual. No hay contrato compartido (constante o enum).

---

### DEBT-2: `extractItemId()` con path muerto `r.item.item.id`
**Archivo**: `src/modules/knowledge/console-section.ts:565`

El path `r.item.item.id` sugiere double-nesting, pero el POST `/items` handler retorna `{ item: KnowledgeItem }`. El path `r.item.item.id` nunca matchea. Indica que el autor no verificó la estructura real de respuesta.

---

### DEBT-3: Traducciones incompletas
**Archivo**: `src/modules/knowledge/console-section.ts`

- `chunks: { es: 'chunks', en: 'chunks' }` — la traducción al español debería ser "fragmentos"
- Badges `'Visual'` y `'Video'` usan ternario `isEs ? 'Visual' : 'Visual'` — redundante, mismo valor en ambos idiomas

---

## VIOLACIONES DE POLÍTICAS

**NINGUNA ENCONTRADA.** Checklist:

| Regla | Estado |
|-------|--------|
| No `process.env` fuera de kernel | PASS |
| Kernel HTTP helpers (no redefinir) | PASS |
| Config helpers (numEnv, boolEnv) | PASS |
| ESM imports con `.js` | PASS |
| `noUncheckedIndexedAccess` | PASS |
| SQL parametrizado ($1, $2) | PASS |
| No ORM | PASS |
| No imports directos entre módulos | PASS |
| No Express/Fastify | PASS |
| Naming conventions | PASS |

---

## COMPILACIÓN TYPESCRIPT

Sin errores semánticos en los archivos modificados. Los únicos errores del `tsc --noEmit` son por dependencias faltantes en el entorno (`@types/node`, `pino`, `pg`, etc.) — no relacionados con estos cambios.

---

## NOTA: Core boost compuesto con category boost

`CORE_BOOST = 0.15` y `CATEGORY_BOOST = 0.2` son ambos aditivos. Un documento core en la categoría correcta recibe **+0.35 flat** a su score. Dado que los scores combinados típicos están en rango 0.05-0.6, este boost puede ser dominante para resultados de baja relevancia pero que son core + categoría match. Monitorear en producción.

---

## RESUMEN POR SEVERIDAD

| Severidad | Hallazgos |
|-----------|-----------|
| **ALTO** | BUG-4 (missing await, try/catch muerto), BUG-5 (index chunks se duplican en re-sync) |
| **MEDIO** | BUG-1 (cache stale), BUG-6 (sourceType hardcoded), GAP-1 (llmDescription dead), GAP-3 (index chunks), REDUNDANCY-1+2 (4x copy-paste) |
| **BAJO** | BUG-2 (console.log), BUG-3 (verify-url), GAP-2 (liveQueryInfo), GAP-4 (web images), COMPLEXITY-1/2/3, DEBT-1/2/3 |

## TOP 7 FIXES RECOMENDADOS (por prioridad)

1. **Agregar `await`** en handler de expand_knowledge (BUG-4) — try/catch no funciona sin esto
2. **Fix hash de index chunks** — usar hash determinístico o delete-before-insert para evitar duplicados (BUG-5)
3. **Conectar `invalidateExpandCache()`** al flujo de re-training (BUG-1)
4. **Fix `sourceType` de index chunks** — usar el tipo real del item, no hardcoded `'drive'` (BUG-6)
5. **Extraer helpers** para los 4 patrones copy-paste de `pageTexts` y `enrichWithLLM` (REDUNDANCY-1+2)
6. **Conectar `llmDescription`** o eliminar el parámetro muerto de los chunkers (GAP-1)
7. **Eliminar `console.log`** de debug + `skipScannerFallback` dead code (BUG-2 + COMPLEXITY-3)
