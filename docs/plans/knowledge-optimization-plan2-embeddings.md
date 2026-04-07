# Plan 2: Embedding Enrichment + Search Boost + Shareable

> **Depende de**: Plan 1 (Extractores Globales)
> **Paralelo con**: Plan 3 (UI/UX)
> **Branch**: `feat/knowledge-embedding-enrichment`
> **Derivado de**: `claude/project-planning-session-nrsYJ` (después de merge Plan 1)

## Objetivo

Enriquecer los embeddings del knowledge con metadata contextual (descripciones del admin, tab, column, LLM), crear chunks índice para knowledge con múltiples sub-documentos, agregar core boost en búsqueda, y hacer funcional el flag shareable en el contexto del agente.

## Contexto

### Estado actual (problemas)
1. Las descripciones del admin (`item.description`, `tab.description`, `column.description`) **NO se incluyen** en el texto del chunk que se embede — son metadata separada que no participa en embeddings
2. Las descripciones LLM de los extractores (resultado de `enrichWithLLM()`) tampoco se incluyen en el chunk content
3. No hay chunk índice para knowledge con múltiples tabs/documentos — el agente no tiene overview del contenido
4. Documentos marcados como core NO tienen boosting en búsqueda vector/FTS
5. El flag `shareable` se pasa en la inyección pero el `context-builder.ts` **NO lo renderiza** — el agente nunca ve la URL ni sabe que puede compartirla
6. La instrucción de compartir links solo existe en el skill `drive-navigation.md` (lazy-loaded, puede nunca cargarse)

### Estado deseado
- Descripciones del admin y LLM enriquecen el texto del chunk → mejoran embedding y FTS
- Chunks índice dan overview del contenido multi-documento
- Core docs tienen +0.15 boost en búsqueda
- El agente ve `(compartible: URL)` junto a items shareable en el contexto
- Eliminar `fullVideoEmbed` (dead code)

## Tareas

### Tarea 1: Prepender descripciones al chunk content

**Archivos**: `src/modules/knowledge/item-manager.ts` (en `persistSmartChunks()` y cada loader)

**Estrategia**: Antes de llamar a `linkChunks()` y persistir, prepender metadata contextual al `content` del **primer chunk** de cada documento.

**Formato del prepend para el primer chunk**:
```
[Contexto: {item.description}]
[Fuente: {tab.description || doc.description}]
{contenido original del chunk}
```

**Para chunks de Sheets (CSV)**, prepender al header de CADA chunk:
```
[Contexto: {item.description}. Columnas: {column descriptions as "ColName: desc, ColName2: desc2"}]
{HEADERS}
{ROW_DATA}
```

**Para chunks con descripciones visuales LLM** (de Plan 1):
```
[Descripción visual: {llm visual description de las páginas en este chunk}]
{contenido de texto extraído}
```

**Implementación en `persistSmartChunks()`** (línea 149):
```typescript
// Nuevo parámetro en opts:
opts?: {
  buffer?: Buffer
  description?: string     // ya existe
  fileUrl?: string         // ya existe
  tabDescription?: string  // NUEVO
  columnDescriptions?: string  // NUEVO: "Col1: desc, Col2: desc"
  llmVisualDescriptions?: Array<{ pageRange: string; description: string }>  // NUEVO
}

// Antes de linkChunks(), enriquecer primer chunk:
if (chunks.length > 0 && opts?.description) {
  const prefix = `[Contexto: ${opts.description}]`
  chunks[0].content = `${prefix}\n${chunks[0].content ?? ''}`
}
```

**Para sheets, en `loadSheetsContent()`**:
- Construir string de column descriptions: `columnDescriptions = nonIgnoredColumns.map(c => c.description ? `${c.columnName}: ${c.description}` : null).filter(Boolean).join(', ')`
- Si hay descriptions, prepender `[Contexto: {item.description}. Columnas: {columnDescriptions}]` al header de cada chunk

**Para multimedia con llmEnrichment** (del Plan 1):
- Si el chunk tiene `metadata.visualDescription`, prepender al content
- Esto mejora tanto el embedding (si es texto) como el FTS

**Nota**: Para chunks multimodal (PDF, image, video, audio), el `content` se usa para FTS pero el embedding usa el binario. Prepender al content mejora la búsqueda por texto sin afectar el embedding multimodal.

---

### Tarea 2: Crear chunks índice para knowledge multi-documento

**Archivos**: `src/modules/knowledge/item-manager.ts`

**Cuándo crear**: Cuando un knowledge item tiene múltiples tabs/documentos (Sheets multi-tab, Drive folders, YouTube playlists/channels).

**Implementación**: Al final de `loadContent()`, después de procesar todos los tabs/documentos:

```typescript
// Crear chunk índice
const indexContent = buildIndexChunk(item, processedDocs)
// processedDocs = array de { title, description, chunkCount, sourceType }

function buildIndexChunk(item: KnowledgeItem, docs: ProcessedDocInfo[]): EmbeddableChunk {
  const lines = [
    `[Índice de "${item.title}"]`,
    item.description ? `Descripción: ${item.description}` : '',
    `Contiene ${docs.length} documentos:`,
    ...docs.map((d, i) => `${i + 1}. ${d.title}${d.description ? ` — ${d.description}` : ''} (${d.chunkCount} fragmentos)`),
  ].filter(Boolean)

  return {
    content: lines.join('\n'),
    contentType: 'text',
    mediaRefs: null,
    metadata: {
      sourceType: item.sourceType,
      isIndex: true,  // marca especial para que no participe en navegación prev/next de contenido
    },
  }
}
```

**Persistencia**: El chunk índice se persiste como un documento separado con `sourceRef = item.id` y title `"Índice: {item.title}"`.

**En la práctica**:
- Sheets con 5 tabs → chunk índice dice "Contiene: Tab Ventas (45 filas), Tab Precios (120 filas)..."
- Drive folder con 10 archivos → chunk índice lista todos los archivos con sus tipos
- YouTube playlist → chunk índice lista todos los videos con duración

---

### Tarea 3: Core boost en búsqueda

**Archivos**: `src/modules/knowledge/pg-store.ts`, `src/modules/knowledge/search-engine.ts`

#### 3a. Agregar `is_core` al resultado de búsqueda

**En `pg-store.ts`** — `searchChunksFTS()` (línea 533) y `searchChunksVector()` (línea 585):
- Agregar `d.is_core` al SELECT
- Agregar `is_core` al GROUP BY
- Retornar `isCore: r.is_core` en el mapeo

**Tipo de retorno** actualizado:
```typescript
{
  chunkId: string
  documentId: string
  content: string
  // ... existentes
  isCore: boolean  // NUEVO
}
```

#### 3b. Aplicar boost en search-engine.ts

**En `search-engine.ts`** (después de línea 150, junto al category boost):

```typescript
const CORE_BOOST = 0.15

// Apply core boost
for (const entry of scored.values()) {
  if (entry.isCore) {
    entry.combinedScore += CORE_BOOST
  }
}
```

**Ajuste al Map `scored`**: agregar campo `isCore: boolean` al tipo del Map.

**En el merge de resultados** (líneas 94-137):
- Vector results: `isCore: r.isCore`
- FTS results: `isCore: r.isCore` (merge con existing: `existing.isCore = existing.isCore || r.isCore`)
- FAQ results: `isCore: false`

---

### Tarea 4: Hacer funcional `shareable` en context-builder.ts

**Archivos**: `src/engine/prompts/context-builder.ts`

**Estado actual** (líneas 247-256): Los items se listan así:
```
- Item Title — Item description [CONSULTA_VIVA: tool, id=X]
```
El `sourceUrl` y `shareable` están disponibles en el item pero NO se renderizan.

**Cambio**: Agregar tag `(compartible: URL)` cuando `item.shareable && item.sourceUrl`:

```typescript
for (const item of items) {
  const desc = item.description ? ` — ${item.description}` : ''
  const liveTag = item.liveQueryEnabled && item.sourceId && item.sourceType
    ? ` [CONSULTA_VIVA: ${LIVE_QUERY_TOOL[item.sourceType] ?? item.sourceType}, id=${item.sourceId}]`
    : ''
  const shareTag = item.shareable && item.sourceUrl
    ? ` (compartible: ${item.sourceUrl})`
    : ''
  parts.push(`    - ${item.title}${desc}${liveTag}${shareTag}`)
}
```

**Repetir** para el bloque de `noCategory` (líneas 257-265).

**Agregar instrucción** después del bloque de items (antes de core docs, ~línea 267):
```typescript
if (inj.items?.some(i => i.shareable)) {
  parts.push(`[Nota: Los items marcados "(compartible: URL)" pueden compartirse con el usuario. Comparte el enlace cuando sea relevante para la conversación. Para carpetas de Drive, comparte el enlace del archivo específico, no de la carpeta raíz.]`)
}
```

Esto asegura que:
1. El agente VE la URL del item shareable
2. Tiene instrucción de cuándo y cómo compartir
3. No depende de que cargue el skill de drive-navigation

---

### Tarea 5: Eliminar `fullVideoEmbed` (dead code)

**Archivos afectados**:

1. `src/modules/knowledge/types.ts` — Eliminar campo `fullVideoEmbed` de `KnowledgeItem`
2. `src/modules/knowledge/pg-store.ts` — Eliminar referencias a `full_video_embed` en queries INSERT/UPDATE/SELECT y en el tipo `ItemRow`
3. `src/modules/knowledge/item-manager.ts` — Eliminar cualquier referencia
4. `src/modules/knowledge/console-section.ts` — Eliminar si aparece
5. **NO crear migración para DROP COLUMN** — la columna en DB no molesta, y dropearla en producción puede ser riesgoso. Solo limpiar el código TypeScript.

**Verificación**: Buscar `fullVideoEmbed` y `full_video_embed` en todo el codebase y limpiar todas las referencias.

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/modules/knowledge/item-manager.ts` | Prepend descriptions, index chunks, cleanup |
| `src/modules/knowledge/extractors/smart-chunker.ts` | Posible: aceptar description context |
| `src/modules/knowledge/pg-store.ts` | Agregar is_core a search queries |
| `src/modules/knowledge/search-engine.ts` | Core boost +0.15 |
| `src/engine/prompts/context-builder.ts` | Renderizar shareable URL + instrucción |
| `src/modules/knowledge/types.ts` | Eliminar fullVideoEmbed |

## Dependencias
- Plan 1 debe estar completo (los chunks ya tienen llmEnrichment propagado)

## Riesgos
1. **Prepend inflates chunk size**: Las descripciones prepended agregan ~50-200 chars. Con MAX_TEXT_WORDS=6000, esto es negligible.
2. **Index chunk noise**: El chunk índice podría matchear queries genéricas y diluir resultados. Mitigación: marcar con `isIndex: true` y considerar excluirlo del vector search si genera ruido.
3. **Core boost tunning**: +0.15 es conservador. Si en producción los core no rankean suficiente, subir a +0.20. Si dominan demasiado, bajar a +0.10.

## Criterios de éxito
- [ ] Chunk de un Sheet tiene `[Contexto: descripción del admin. Columnas: Col1: desc, Col2: desc]` al inicio
- [ ] Primer chunk de un PDF tiene `[Contexto: descripción del admin]`
- [ ] Knowledge con 5 tabs tiene un chunk índice con la lista de tabs
- [ ] Búsqueda retorna core docs con score más alto (verificable en GET /search endpoint)
- [ ] Agente ve `(compartible: URL)` en el contexto para items shareable
- [ ] `fullVideoEmbed` no aparece en ningún archivo .ts
- [ ] Build sin errores
