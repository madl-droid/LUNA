# Plan 4: Knowledge Audit Fixes — Bugs, Gaps y Cleanup

> **Depende de**: Plans 1-3 (ya mergeados)
> **Branch**: `feat/knowledge-audit-fixes` (derivar de `claude/project-planning-session-nrsYJ`)
> **Estimación**: 7 tareas, ejecutable en una sola sesión
> **Referencia**: `docs/reports/audit-knowledge-optimization.md`

## Objetivo

Resolver todos los hallazgos de la auditoría: 6 bugs (2 altos), 2 gaps relevantes, 2 redundancias, y cleanup de dead code/debug artifacts.

## Tareas

### Tarea 1: [ALTO] Fix missing `await` en expand_knowledge handler (BUG-4)

**Archivo**: `src/modules/knowledge/manifest.ts` (~línea 1396)

El handler retorna `knowledgeManager!.expandKnowledge(documentId)` sin `await`. El try/catch es dead code.

**Fix**:
```typescript
handler: async (input) => {
  try {
    const documentId = input.documentId as string
    return await knowledgeManager!.expandKnowledge(documentId)  // ← agregar await
  } catch (err) {
    return { success: false, error: String(err) }
  }
},
```

---

### Tarea 2: [ALTO] Fix index chunks duplicados en re-sync (BUG-5 + BUG-6)

**Archivo**: `src/modules/knowledge/item-manager.ts` (~líneas 525-560)

**Dos problemas**:
1. `contentHash` usa `Date.now()` → hash diferente cada vez → documentos índice se acumulan
2. `sourceType: 'drive'` hardcoded → debería ser el tipo real del item

**Fix**:
```typescript
// Antes de crear el nuevo index, eliminar el anterior si existe
await this.pgStore.getPool().query(
  `DELETE FROM knowledge_chunks WHERE document_id IN (
    SELECT id FROM knowledge_documents WHERE source_ref = $1 AND metadata->>'isIndex' = 'true'
  )`, [id]
)
await this.pgStore.getPool().query(
  `DELETE FROM knowledge_documents WHERE source_ref = $1 AND metadata->>'isIndex' = 'true'`, [id]
)

// Hash determinístico (sin Date.now)
const indexHash = createHash('sha256').update(`index:${item.id}`).digest('hex')

// sourceType del item real (no hardcoded 'drive')
const indexDocId = await this.pgStore.insertDocument({
  ...
  sourceType: item.sourceType,  // ← en vez de 'drive'
  ...
})
```

---

### Tarea 3: [MEDIO] Conectar `invalidateExpandCache()` al re-training (BUG-1)

**Archivo**: `src/modules/knowledge/item-manager.ts` — en `loadContent()` (~línea 493)

Al inicio de `loadContent()`, antes de limpiar chunks previos, invalidar el cache de expand para todos los docs del item:

```typescript
// Al inicio de loadContent(), después de obtener el item:
const existingDocs = await this.pgStore.getPool().query<{ id: string }>(
  `SELECT id FROM knowledge_documents WHERE source_ref = $1`, [id]
)
for (const doc of existingDocs.rows) {
  await this.knowledgeManager.invalidateExpandCache(doc.id)
}
```

**Nota**: `loadContent()` está en `KnowledgeItemManager` que tiene acceso al registry. Verificar si `invalidateExpandCache` es accesible (podría necesitar pasar la referencia del KnowledgeManager o exponer un método directo que use Redis del registry).

**Alternativa más simple**: En `loadContent()`, después de `this.pgStore.deleteItemChunks(id)`, hacer la invalidación directamente con Redis:
```typescript
const redis = this.registry.getRedis()
for (const doc of existingDocs.rows) {
  await redis.del(`expand:${doc.id}`).catch(() => {})
}
```

---

### Tarea 4: [MEDIO] Extraer helpers para patrones copy-paste (REDUNDANCY-1 + REDUNDANCY-2)

**Archivo**: `src/modules/knowledge/item-manager.ts`

**4a. Helper para reconstrucción de page texts**:
```typescript
/** Reconstruct per-page texts from extractor sections */
function reconstructPageTexts(pdfResult: ExtractedContent): { pageTexts: string[]; totalPages: number } {
  const totalPages = (pdfResult.metadata.pages ?? pdfResult.sections.length) || 1
  const pageTextsMap = new Map<number, string[]>()
  for (const section of pdfResult.sections) {
    const page = section.page ?? 1
    const list = pageTextsMap.get(page) ?? []
    list.push(section.title ? `${section.title}\n${section.content}` : section.content)
    pageTextsMap.set(page, list)
  }
  const pageTexts = Array.from({ length: totalPages }, (_, i) =>
    (pageTextsMap.get(i + 1) ?? []).join('\n'),
  )
  return { pageTexts, totalPages }
}
```

**4b. Helper para enrichWithLLM de PDFs**:
```typescript
/** Enrich PDF extraction with visual descriptions */
async function enrichPdfVisual(
  pdfResult: ExtractedContent,
  registry: Registry,
): Promise<Array<{ pageRange: string; description: string }> | undefined> {
  const { enrichWithLLM } = await import('../../extractors/index.js')
  const enriched = await enrichWithLLM({ ...pdfResult, kind: 'document' as const }, registry)
  return enriched.kind === 'document' ? enriched.llmEnrichment?.visualDescriptions : undefined
}
```

**Nota sobre COMPLEXITY-2**: El guard `enriched.kind === 'document'` siempre es true. Pero el helper lo encapsula, así que no importa — queda internamente y el caller no lo ve.

**Reemplazar** las 4 instancias en: `loadSlidesContent()`, `loadPdfContent()`, `persistVisualPdf()`, `persistVisualSlides()`.

---

### Tarea 5: [MEDIO] Conectar `llmDescription` o limpiar dead code (GAP-1)

**Archivos**: `src/modules/knowledge/extractors/smart-chunker.ts`, `src/modules/knowledge/item-manager.ts`

El parámetro `llmDescription` se agregó a `chunkDocs()` pero ningún caller lo pasa.

**Opción A — Conectar**: En `loadDocsContent()`, después de extraer el body, pasar la descripción del item:
```typescript
const chunks = chunkDocs(body, {
  sourceFile: item.title,
  sourceType: 'docs',
  llmDescription: item.description || undefined,
})
```

**Opción B — Eliminar**: Quitar `llmDescription` de las firmas de los chunkers si no lo necesitamos.

**Recomendación**: Opción A — ya está el plumbing, solo falta conectar. La descripción del admin como metadata en el chunk mejora FTS. Esto complementa lo que hace `enrichChunksWithContext()` (que prepende al content del primer chunk), pero `llmDescription` va en metadata, no en content.

**Decisión**: Si `enrichChunksWithContext()` ya prepende la descripción al content, entonces `llmDescription` en metadata es redundante. En ese caso, **Opción B — eliminar** el parámetro muerto para no confundir.

→ **Ejecutor: evaluar si `enrichChunksWithContext()` ya cubre el caso. Si sí, eliminar `llmDescription` de las firmas. Si no, conectar.**

---

### Tarea 6: [BAJO] Cleanup — console.log, dead code, traducciones

**Archivos**: `src/modules/knowledge/console-section.ts`, `src/modules/knowledge/manifest.ts`

**6a. Eliminar console.log de debug** (BUG-2):
- Línea ~813-814: `console.log('CREATE response:', ...)` — eliminar

**6b. Fix verify-url para non-URLs** (BUG-3):
- Cuando `!extracted` (no es URL reconocida), verificar si al menos empieza con `http`:
```typescript
if (!extracted) {
  if (body.sourceUrl.startsWith('http')) {
    jsonResponse(res, 200, { accessible: true, sourceType: 'web' })
  } else {
    jsonResponse(res, 400, { error: 'URL no válida', accessible: false })
  }
  return
}
```

**6c. Limpiar `skipScannerFallback`** (COMPLEXITY-3):
- El servidor siempre retorna `sourceType` en verify-url
- Eliminar la lógica de URL sniffing (`lUrl.indexOf('.pdf')`, etc.)
- Solo usar `v.sourceType` del servidor. Mantener un fallback mínimo por si el servidor no retorna tipo (edge case):
```javascript
var typesThatSkipScanner = ['pdf', 'web', 'slides', 'youtube'];
skipScanner = v.sourceType ? typesThatSkipScanner.indexOf(v.sourceType) !== -1 : true;
```

**6d. Fix traducciones** (DEBT-3):
- `chunks` → `fragmentos` para español
- Eliminar ternarios redundantes en badges (`isEs ? 'Visual' : 'Visual'` → simplemente `'Visual'`)

**6e. Eliminar `extractItemId` path muerto** (DEBT-2):
- Quitar `if (r.item.item && r.item.item.id) return r.item.item.id;` — nunca matchea, el POST retorna `{ item: { id } }`

---

### Tarea 7: [BAJO] Estabilizar matching de secciones visuales (DEBT-1)

**Archivo**: `src/extractors/index.ts` (~línea 279)

El filtro `s.title?.includes('(visual)') || s.title?.includes('OCR')` depende de strings de `extractPDF`.

**Fix**: Exportar constantes compartidas desde `src/extractors/pdf.ts`:
```typescript
// En pdf.ts
export const VISUAL_SECTION_MARKER = '(visual)'
export const OCR_SECTION_MARKER = 'OCR'
```

```typescript
// En index.ts (enrichWithLLM case 'document')
import { VISUAL_SECTION_MARKER, OCR_SECTION_MARKER } from './pdf.js'
const visualSections = result.sections.filter(s =>
  s.title?.includes(VISUAL_SECTION_MARKER) || s.title?.includes(OCR_SECTION_MARKER) || extractor === 'pdf-ocr-vision',
)
```

**Nota**: Verificar primero en `pdf.ts` qué strings usa exactamente para marcar secciones visuales. Si no usa exactamente `(visual)` y `OCR`, ajustar las constantes.

---

## Items NO incluidos (deuda aceptada)

| Item | Razón |
|------|-------|
| GAP-2: `liveQueryInfo` en search_knowledge | Ya existe en `expand_knowledge`. El agente puede buscar → expandir → ver liveQueryHint. No es crítico duplicarlo en search. |
| GAP-3: Index chunks runtime verification | Se resuelve indirectamente con el fix de BUG-5 (dedup). Si buildIndexChunk funciona, el fix elimina el riesgo de duplicación. |
| GAP-4: Web images | Las imágenes web son URL-only, no se descargan. El alt-text se preserva en el texto. El impacto es mínimo. |
| COMPLEXITY-1: enrichWithLLM naming | Es naming, no bug. Renombrar requiere cambiar todos los callers cross-codebase. |
| Core+Category boost compuesto | Monitorear en producción antes de ajustar. |

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/manifest.ts` | await en expand_knowledge, verify-url fix |
| `src/modules/knowledge/item-manager.ts` | Index dedup, cache invalidation, helpers, cleanup |
| `src/modules/knowledge/console-section.ts` | console.log, skipScanner, traducciones, extractItemId |
| `src/modules/knowledge/extractors/smart-chunker.ts` | Posible: eliminar llmDescription si redundante |
| `src/extractors/index.ts` | Constantes para visual section matching |
| `src/extractors/pdf.ts` | Export constantes de markers |

## Criterios de éxito
- [ ] `expand_knowledge` handler tiene `await` → try/catch funciona
- [ ] Re-sync de item no duplica index chunks (hash determinístico + delete-before-insert)
- [ ] Re-training invalida cache de expand_knowledge
- [ ] Index chunks tienen sourceType real del item
- [ ] 0 patrones copy-paste de pageTexts/enrichWithLLM (extraídos a helpers)
- [ ] 0 console.log de debug en producción
- [ ] verify-url rechaza non-URLs
- [ ] Build limpio
