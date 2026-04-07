# Plan 2: Embedding Enrichment + Deep Knowledge + Search Boost

> **Depende de**: Plan 1 (Extractores Globales)
> **Paralelo con**: Plan 3 (UI/UX)
> **Branch**: `feat/knowledge-deep-search` (derivar de `claude/project-planning-session-nrsYJ`, después de merge Plan 1)
> **Estimación**: 7 tareas

## Objetivo

Enriquecer los embeddings con metadata contextual (descripciones admin/tab/column/LLM), crear chunks índice, agregar core boost en búsqueda, hacer funcional el shareable, crear la tool `expand_knowledge` para profundización, enriquecer la respuesta de `search_knowledge`, y agregar instrucción hardcoded de "siempre buscar".

## Contexto

### Estado actual (problemas)
1. Descripciones admin/tab/column NO participan en embeddings — metadata separada
2. No hay chunk índice para knowledge multi-documento
3. Core docs NO tienen boost en búsqueda vector/FTS
4. `shareable` se pasa en inyección pero context-builder NO lo renderiza — agente nunca ve URL
5. `search_knowledge` no retorna `documentId`, `chunkIndex`, `chunkTotal`, `sourceType` (datos que existen en DB)
6. No hay tool para profundizar en un documento encontrado (expand/read more)
7. Instrucción de buscar knowledge no es obligatoria — agente puede adivinar
8. `fullVideoEmbed` es dead code

### Estado deseado
- Descripciones enriquecen chunks → mejor embedding y FTS
- Chunks índice dan overview de contenido multi-documento
- Core boost +0.15 en búsqueda
- Agente ve URLs compartibles y sabe cuándo compartir
- `search_knowledge` retorna info completa para decidir si profundizar
- `expand_knowledge` permite leer documento completo o sección
- Instrucción mandatoria de buscar antes de responder
- Dead code eliminado

## Tareas

### Tarea 1: Prepender descripciones al chunk content

**Archivos**: `src/modules/knowledge/item-manager.ts` (`persistSmartChunks()` y loaders)

**Primer chunk de cada documento** — prepend contextual:
```
[Contexto: {item.description}]
[Fuente: {tab.description || doc.description}]
{contenido original}
```

**Sheets (CSV) — cada chunk** — prepend con descriptions de columnas:
```
[Contexto: {item.description}. Columnas: {Col1: desc, Col2: desc}]
{HEADERS}
{ROW_DATA}
```

**Chunks con descripciones visuales LLM** (de Plan 1):
```
[Descripción visual: {llm description de páginas en este chunk}]
{texto extraído}
```

**Implementación**: En `persistSmartChunks()` (línea ~149), nuevos campos en opts:
```typescript
opts?: {
  buffer?: Buffer; description?: string; fileUrl?: string   // existentes
  tabDescription?: string                                     // NUEVO
  columnDescriptions?: string                                 // NUEVO: "Col1: desc, Col2: desc"
  llmVisualDescriptions?: Array<{ pageRange: string; description: string }>  // NUEVO
}
```

Antes de `linkChunks()`, enriquecer primer chunk con description. Para sheets, enriquecer header de cada chunk.

**Nota**: Para chunks multimodal (PDF, image, video), el `content` se usa para FTS; el embedding usa el binario. Prepender mejora búsqueda texto sin afectar embedding multimodal.

---

### Tarea 2: Crear chunks índice para knowledge multi-documento

**Archivo**: `src/modules/knowledge/item-manager.ts`

Al final de `loadContent()`, para items con múltiples tabs/documentos (Sheets multi-tab, Drive folders, YouTube playlists/channels):

```typescript
function buildIndexChunk(item, docs: ProcessedDocInfo[]): EmbeddableChunk {
  const lines = [
    `[Índice de "${item.title}"]`,
    item.description ? `Descripción: ${item.description}` : '',
    `Contiene ${docs.length} documentos:`,
    ...docs.map((d, i) => `${i+1}. ${d.title}${d.description ? ` — ${d.description}` : ''} (${d.chunkCount} fragmentos)`),
  ].filter(Boolean)
  return { content: lines.join('\n'), contentType: 'text', mediaRefs: null, metadata: { isIndex: true } }
}
```

Se persiste como documento separado con `sourceRef = item.id`, title `"Índice: {item.title}"`.

---

### Tarea 3: Core boost en búsqueda

**Archivos**: `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/search-engine.ts`

**3a. pg-store.ts** — `searchChunksFTS()` (línea 533) y `searchChunksVector()` (línea 585):
- Agregar `d.is_core` al SELECT y GROUP BY
- Retornar `isCore: r.is_core` en el mapeo

**3b. search-engine.ts** — después del category boost (línea ~150):
```typescript
const CORE_BOOST = 0.15
for (const entry of scored.values()) {
  if (entry.isCore) entry.combinedScore += CORE_BOOST
}
```

Propagación en merge: vector results `isCore: r.isCore`, FTS merge `existing.isCore ||= r.isCore`, FAQ `isCore: false`.

---

### Tarea 4: Enriquecer respuesta de `search_knowledge`

**Archivos**: `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/search-engine.ts`, `src/modules/knowledge/types.ts`, `src/modules/knowledge/manifest.ts`

**4a. pg-store.ts** — agregar a las queries de búsqueda:
```sql
-- Campos que YA EXISTEN en DB pero no se seleccionan:
c.chunk_index,
c.chunk_total,
d.source_type   -- del documento padre (JOIN ya existe)
```

**4b. types.ts** — extender `KnowledgeSearchResult`:
```typescript
interface KnowledgeSearchResult {
  // existentes
  content: string; source: string; score: number; type: 'chunk' | 'faq'
  documentId?: string; faqId?: string; fileUrl?: string
  // NUEVOS
  chunkIndex?: number
  chunkTotal?: number
  sourceType?: string     // 'sheets' | 'docs' | 'pdf' | 'drive' | 'web' | 'youtube'
  isCore?: boolean
  liveQueryInfo?: string  // e.g. "sheets-read:SPREADSHEET_ID" — para que el agente sepa cómo consultar en vivo
}
```

**4c. search-engine.ts** — propagar nuevos campos en merge de resultados.

**4d. manifest.ts** — actualizar el handler del tool para retornar los nuevos campos:
```typescript
results: results.map(r => ({
  content: r.content,
  source: r.source,
  score: r.score,
  type: r.type,
  fileUrl: r.fileUrl,
  documentId: r.documentId,      // NUEVO
  chunkIndex: r.chunkIndex,      // NUEVO
  chunkTotal: r.chunkTotal,      // NUEVO
  sourceType: r.sourceType,      // NUEVO
}))
```

**Nota sobre liveQueryInfo**: Necesitamos que el agente sepa si puede profundizar con CONSULTA_VIVA. Para esto, cruzar el `documentId` → `knowledge_documents.source_ref` → `knowledge_items` → si `liveQueryEnabled`, construir el tag `"tool:sourceId"` (e.g. `"sheets-read:1a2b3c"`). Esto puede hacerse en el handler o precomputarse. Evaluar performance: si es costoso, hacerlo solo para los top 3 resultados.

---

### Tarea 5: Nueva tool `expand_knowledge`

**Archivos**: `src/modules/knowledge/manifest.ts`, `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/knowledge-manager.ts`

**Tool definition**:
```typescript
{
  name: 'expand_knowledge',
  description: 'Expande un resultado de búsqueda para obtener más contexto del documento completo. Usa después de search_knowledge cuando necesites más detalle.',
  parameters: {
    documentId: { type: 'string', description: 'ID del documento (viene de search_knowledge)', required: true },
  },
}
```

**Handler**:
```typescript
async expandKnowledge(documentId: string): Promise<ExpandResult> {
  // 1. Obtener documento
  const doc = await pgStore.getDocument(documentId)
  if (!doc) return { error: 'Documento no encontrado' }

  // 2. Obtener todos los chunks del documento
  const chunks = await pgStore.getChunksByDocumentId(documentId)  // NUEVO método

  // 3. Estrategia inteligente por tamaño
  let content: string
  if (chunks.length <= 15) {
    // Documento pequeño/mediano: retornar todo concatenado
    content = chunks.map(c => c.content).filter(Boolean).join('\n\n---\n\n')
  } else {
    // Documento grande: retornar resumen + primeros/últimos chunks
    const first5 = chunks.slice(0, 5).map(c => c.content).filter(Boolean).join('\n\n')
    const last3 = chunks.slice(-3).map(c => c.content).filter(Boolean).join('\n\n')
    content = `[Documento con ${chunks.length} fragmentos. Mostrando primeros 5 y últimos 3:]\n\n${first5}\n\n[...${chunks.length - 8} fragmentos intermedios...]\n\n${last3}`
  }

  // 4. Info de consulta viva (si aplica)
  let liveQueryHint: string | undefined
  if (doc.sourceRef) {
    const item = await pgStore.getItem(doc.sourceRef)
    if (item?.liveQueryEnabled && item.sourceId && item.sourceType) {
      const toolMap: Record<string, string> = { sheets: 'sheets-read', docs: 'docs-read', slides: 'slides-read', drive: 'drive-list-files' }
      liveQueryHint = `Puedes consultar este recurso en vivo: ${toolMap[item.sourceType] ?? item.sourceType}(id: ${item.sourceId})`
    }
  }

  // 5. Info de compartir
  const fileUrl = doc.metadata?.fileUrl ?? undefined
  const shareable = fileUrl ? true : false  // si tiene URL, es compartible

  return {
    success: true,
    data: {
      title: doc.title,
      description: doc.description,
      content,
      totalChunks: chunks.length,
      sourceType: doc.sourceType,
      fileUrl: shareable ? fileUrl : undefined,
      liveQueryHint,
    }
  }
}
```

**Nuevo método en pg-store.ts**: `getChunksByDocumentId(docId)`:
```sql
SELECT id, content, chunk_index, chunk_total, section, content_type
FROM knowledge_chunks
WHERE document_id = $1
ORDER BY chunk_index ASC
```

**Cache Redis**: Key `expand:{documentId}`, TTL 15 min. Invalidar cuando se re-entrena el item.

---

### Tarea 6: Shareable en context-builder + instrucción hardcoded

**Archivos**: `src/engine/prompts/context-builder.ts`, `src/engine/prompts/agentic.ts`, `instance/prompts/system/knowledge-mandate.md` (NUEVO)

**6a. context-builder.ts** — renderizar shareable (líneas 249-265):

Agregar `(compartible: URL)` cuando `item.shareable && item.sourceUrl`:
```typescript
const shareTag = item.shareable && item.sourceUrl
  ? ` (compartible: ${item.sourceUrl})`
  : ''
parts.push(`    - ${item.title}${desc}${liveTag}${shareTag}`)
```

Repetir para bloque `noCategory`.

Agregar instrucción después del bloque de items:
```typescript
if (inj.items?.some(i => i.shareable)) {
  parts.push(`[Items marcados "(compartible: URL)" pueden compartirse con el usuario cuando sea relevante. Para carpetas de Drive, comparte el enlace del archivo específico que contiene la respuesta, no de la carpeta raíz.]`)
}
```

**6b. Instrucción hardcoded: "siempre buscar"**

Crear `instance/prompts/system/knowledge-mandate.md`:
```markdown
MANDATO DE BÚSQUEDA EN CONOCIMIENTO (no desactivable):

Para CUALQUIER pregunta sobre productos, servicios, procesos, políticas, precios, disponibilidad,
o información del negocio, SIEMPRE usa search_knowledge ANTES de responder.

- NUNCA respondas de memoria sobre datos del negocio — siempre verifica con search_knowledge.
- Si search_knowledge devuelve un resultado relevante con documentId, puedes usar expand_knowledge
  para obtener más contexto del documento completo.
- Si el item tiene CONSULTA_VIVA disponible, puedes usarla para datos en tiempo real.
- Si el item es compartible (tiene URL), comparte el enlace cuando sea relevante para el usuario.

Flujo correcto:
1. Usuario pregunta sobre el negocio → search_knowledge(query)
2. Resultado insuficiente → expand_knowledge(documentId) o CONSULTA_VIVA si disponible
3. Responder con la información encontrada
4. Compartir enlace si es relevante y el item es compartible
```

**6c. agentic.ts** — inyectar mandato (después de security-preamble, línea ~74):
```typescript
const knowledgeMandate = await loadSystemPrompt('knowledge-mandate')
if (knowledgeMandate) {
  systemParts.push(`<knowledge_mandate>\n${knowledgeMandate}\n</knowledge_mandate>`)
}
```

---

### Tarea 7: Eliminar `fullVideoEmbed` (dead code)

**Archivos**: `src/modules/knowledge/types.ts`, `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/item-manager.ts`

- Eliminar campo `fullVideoEmbed` de `KnowledgeItem` type
- Eliminar referencias a `full_video_embed` en queries INSERT/UPDATE/SELECT y tipo `ItemRow`
- **NO crear migración DROP COLUMN** — la columna en DB no molesta
- Solo limpiar TypeScript
- Buscar `fullVideoEmbed` y `full_video_embed` en todo el codebase

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/item-manager.ts` | Prepend descriptions, index chunks |
| `src/modules/knowledge/pg-store.ts` | is_core en search, getChunksByDocumentId, sourceType/chunkIndex/chunkTotal en queries |
| `src/modules/knowledge/search-engine.ts` | Core boost +0.15, propagar nuevos campos |
| `src/modules/knowledge/types.ts` | Extender KnowledgeSearchResult, eliminar fullVideoEmbed |
| `src/modules/knowledge/manifest.ts` | Enriquecer search_knowledge response, registrar expand_knowledge |
| `src/modules/knowledge/knowledge-manager.ts` | expandKnowledge() method |
| `src/engine/prompts/context-builder.ts` | Renderizar shareable URL + instrucción |
| `src/engine/prompts/agentic.ts` | Inyectar knowledge-mandate |
| `instance/prompts/system/knowledge-mandate.md` | NUEVO — instrucción mandatoria |

## Riesgos y mitigaciones
1. **Prepend inflates chunk size**: ~50-200 chars extra, negligible con MAX_TEXT_WORDS=6000
2. **Index chunk noise**: Podría matchear queries genéricas → marcar `isIndex: true`, monitorear
3. **Core boost tuning**: +0.15 conservador, ajustar en producción si necesario
4. **expand_knowledge performance**: Cache Redis 15 min mitiga queries repetidas
5. **liveQueryInfo lookup**: JOIN extra → solo para top resultados, evaluar performance

## Criterios de éxito
- [ ] Chunk de Sheet tiene `[Contexto: desc admin. Columnas: Col1: desc]` al inicio
- [ ] Primer chunk de PDF tiene `[Contexto: desc admin]`
- [ ] Knowledge con 5 tabs tiene chunk índice listando tabs
- [ ] Búsqueda retorna core docs con score +0.15 más alto
- [ ] `search_knowledge` retorna documentId, chunkIndex, chunkTotal, sourceType
- [ ] `expand_knowledge` retorna documento completo (≤15 chunks) o resumen (>15)
- [ ] Agente ve `(compartible: URL)` en contexto
- [ ] `knowledge-mandate.md` se inyecta en system prompt
- [ ] `fullVideoEmbed` eliminado del código TS
- [ ] Build limpio
